import { randomUUID } from "node:crypto";
import { z } from "zod";
import { after } from "next/server";
import { authenticate, bootstrap, HttpError, sameOrigin } from "@/lib/auth";
import {
  all,
  get,
  run,
  transaction,
  storageConfigured,
  type Session,
} from "@/lib/db";
import { enqueue, listJobs, ownAsset, ownSession } from "@/lib/jobs";
import { MODELS, MAX_UPLOAD } from "@/lib/config";
import { storeUpload } from "@/lib/images";
import { dispatchJob } from "@/lib/dispatch";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
async function readBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max)
    throw new HttpError(413, "Upload or request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "Upload or request is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function body(request: Request) {
  try {
    return JSON.parse((await readBody(request, 160000)).toString());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid request.");
  }
}
async function readiness() {
  if (!storageConfigured()) return "Connect a database to save your canvases.";
  if (!process.env.OPENAI_API_KEY)
    return "Add an OpenAI API key to start generating. Your canvases and references are ready.";
  if (process.env.VERCEL)
    return process.env.VERCEL_DEPLOYMENT_ID
      ? null
      : "Enable Vercel system environment variables and redeploy to start the image queue.";
  const heartbeat = await get<{ seen: number }>(
    "SELECT seen FROM worker_health WHERE id=1",
  );
  return !heartbeat || heartbeat.seen < Date.now() - 20000
    ? "Start the image worker to bring your ideas to life."
    : null;
}
async function route(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    const [resource, id] = path,
      method = request.method;
    if (!["GET", "HEAD"].includes(method)) sameOrigin(request);
    if (resource === "bootstrap" && method === "POST") {
      if (!storageConfigured())
        return json({
          user: null,
          models: MODELS,
          setupMessage: await readiness(),
          maxUpload: MAX_UPLOAD,
        });
      const session = await bootstrap(request);
      return json(
        {
          user: { id: session.user.id },
          models: MODELS,
          setupMessage: await readiness(),
          maxUpload: MAX_UPLOAD,
        },
        200,
        session.cookie ? { "Set-Cookie": session.cookie } : {},
      );
    }
    const user = await authenticate(request);
    if (resource === "me" && method === "GET")
      return json({
        user: { id: user.id },
        models: MODELS,
        setupMessage: await readiness(),
        maxUpload: MAX_UPLOAD,
      });
    if (resource === "sessions") {
      if (method === "GET" && !id)
        return json(
          await all<Session & { cover_id: string | null }>(
            "SELECT s.*, (SELECT j.result_id FROM jobs j WHERE j.session_id=s.id AND j.result_id IS NOT NULL ORDER BY j.created DESC LIMIT 1) cover_id FROM sessions s WHERE s.user_id=? ORDER BY s.updated DESC",
            user.id,
          ),
        );
      if (method === "POST" && !id) {
        const sid = randomUUID();
        await run(
          "INSERT INTO sessions VALUES (?,?,?,?,?)",
          sid,
          user.id,
          "Fresh canvas",
          Date.now(),
          Date.now(),
        );
        return json(await ownSession(user.id, sid), 201);
      }
      await ownSession(user.id, id);
      if (method === "GET") {
        const jobs = await listJobs(user.id, id);
        if (process.env.VERCEL && jobs.some((job) => job.status === "queued"))
          after(async () => {
            for (const job of jobs.filter((job) => job.status === "queued"))
              await dispatchJob(job.id).catch(() => {});
          });
        return json({ session: await ownSession(user.id, id), jobs });
      }
      if (method === "PATCH") {
        const { title } = z
          .object({ title: z.string().trim().min(1).max(80) })
          .parse(await body(request));
        await run(
          "UPDATE sessions SET title=?,updated=? WHERE id=? AND user_id=?",
          title,
          Date.now(),
          id,
          user.id,
        );
        return json({ ok: true });
      }
      if (method === "DELETE") {
        await transaction(async () => {
          if (
            await get(
              "SELECT id FROM jobs WHERE session_id=? AND status IN ('queued','generating')",
              id,
            )
          )
            throw new HttpError(
              409,
              "Wait for pending images before deleting this canvas.",
            );
          await run(
            "DELETE FROM sessions WHERE id=? AND user_id=?",
            id,
            user.id,
          );
        });
        return json({ ok: true });
      }
    }
    if (resource === "assets" && method === "POST") {
      const sessionId = request.headers.get("x-session-id") || "";
      await ownSession(user.id, sessionId);
      return json(
        await storeUpload(
          user.id,
          sessionId,
          await readBody(request, MAX_UPLOAD),
        ),
        201,
      );
    }
    if (resource === "assets" && id && method === "GET") {
      const asset = await ownAsset(user.id, id),
        download = new URL(request.url).searchParams.has("download");
      return new Response(
        new ReadableStream({
          start(controller) {
            const bytes = new Uint8Array(asset.bytes);
            for (let offset = 0; offset < bytes.length; offset += 64 * 1024)
              controller.enqueue(bytes.slice(offset, offset + 64 * 1024));
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Type": asset.mime,
            "Content-Length": String(asset.bytes.length),
            "Cache-Control": "private, no-store",
            "Content-Disposition": `${download ? "attachment" : "inline"}; filename="image-studio-${id}.${asset.mime.split("/")[1]}"`,
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    if (resource === "jobs" && method === "POST") {
      const job = await enqueue(user.id, await body(request), async () => {
        const message = await readiness();
        if (message) throw new HttpError(503, message);
      });
      await dispatchJob(job.id);
      return json({ ...job, refs: JSON.parse(job.refs) }, 202);
    }
    throw new HttpError(404, "Endpoint not found.");
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        { error: "Check your prompt, image count, settings, and references." },
        400,
      );
    return json(
      {
        error:
          "Your inputs are safe. The studio could not finish this request; check the database and queue configuration.",
      },
      500,
    );
  }
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
