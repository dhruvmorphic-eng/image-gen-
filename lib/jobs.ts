import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MODELS, limits, STALE_AFTER } from "./config";
import {
  all,
  get,
  run,
  transaction,
  type Job,
  type Session,
  type Asset,
} from "./db";
import { hash, HttpError } from "./auth";
export const inputSchema = z
  .object({
    sessionId: z.string().uuid(),
    key: z.string().uuid(),
    prompt: z.string().trim().min(1).max(32000),
    model: z.string(),
    size: z.string(),
    quality: z.string(),
    count: z.number().int().min(1).max(4).default(1),
    refs: z.array(z.string().uuid()).max(4).default([]),
    parentId: z.string().uuid().nullable().default(null),
  })
  .strict();
export type Input = z.infer<typeof inputSchema>;
export async function ownSession(userId: string, id: string) {
  const session = await get<Session>(
    "SELECT * FROM sessions WHERE id=? AND user_id=?",
    id,
    userId,
  );
  if (!session) throw new HttpError(404, "Canvas not found.");
  return session;
}
export async function ownAsset(userId: string, id: string) {
  const asset = await get<Asset>(
    "SELECT * FROM assets WHERE id=? AND user_id=?",
    id,
    userId,
  );
  if (!asset) throw new HttpError(404, "Image not found.");
  return asset;
}
export async function enqueue(
  userId: string,
  raw: unknown,
  ready: () => Promise<void> = async () => {},
) {
  const input = inputSchema.parse(raw),
    model = MODELS.find((m) => m.id === input.model);
  if (
    !model ||
    !model.sizes.some((s) => s.value === input.size) ||
    !model.qualities.includes(input.quality)
  )
    throw new HttpError(
      400,
      "These settings are not supported by GPT Image 2.",
    );
  if (new Set(input.refs).size !== input.refs.length)
    throw new HttpError(400, "Each reference must be unique.");
  const { key, ...payload } = input,
    fingerprint = hash(JSON.stringify(payload));
  return transaction(async () => {
    const prior = await get<{ hash: string; job_id: string }>(
      "SELECT * FROM submissions WHERE user_id=? AND key=?",
      userId,
      key,
    );
    if (prior) {
      if (prior.hash !== fingerprint)
        throw new HttpError(
          409,
          "This submission key was already used with different instructions.",
        );
      const job = await get<Job>(
        "SELECT * FROM jobs WHERE id=? AND user_id=?",
        prior.job_id,
        userId,
      );
      if (!job)
        throw new HttpError(409, "This request belonged to a deleted canvas.");
      return job;
    }
    await ready();
    await ownSession(userId, input.sessionId);
    for (const id of input.refs)
      if ((await ownAsset(userId, id)).session_id !== input.sessionId)
        throw new HttpError(400, "References must belong to this canvas.");
    if (input.parentId) {
      const parent = await get<Job>(
        "SELECT * FROM jobs WHERE id=? AND user_id=? AND status='completed'",
        input.parentId,
        userId,
      );
      const ids = parent
        ? [parent.result_id, ...JSON.parse(parent.results || "[]")]
        : [];
      if (!ids.includes(input.refs[0]))
        throw new HttpError(
          400,
          "The selected edit image must be the first reference.",
        );
    }
    const quota = limits(),
      since = Date.now() - 86400_000;
    const used = (await get<{ n: number }>(
      "SELECT COALESCE(SUM(units),0) n FROM usage_events WHERE user_id=? AND created>=?",
      userId,
      since,
    ))!.n;
    const total = (await get<{ n: number }>(
      "SELECT COALESCE(SUM(units),0) n FROM usage_events WHERE created>=?",
      since,
    ))!.n;
    if (used + input.count > quota.daily)
      throw new HttpError(
        429,
        "Your image limit for the last 24 hours has been reached.",
      );
    if (total + input.count > quota.globalDaily)
      throw new HttpError(
        429,
        "The studio has reached its daily image limit. Try again later.",
      );
    if (
      (await get<{ n: number }>(
        "SELECT COUNT(*) n FROM jobs WHERE user_id=? AND status IN ('queued','generating')",
        userId,
      ))!.n >= quota.pending
    )
      throw new HttpError(429, "Wait for a pending generation to finish.");
    const id = randomUUID(),
      now = Date.now();
    await run(
      "INSERT INTO jobs (id,user_id,session_id,prompt,model,size,quality,refs,parent_id,status,created,count) VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?)",
      id,
      userId,
      input.sessionId,
      input.prompt,
      input.model,
      input.size,
      input.quality,
      JSON.stringify(input.refs),
      input.parentId,
      now,
      input.count,
    );
    await run(
      "INSERT INTO submissions VALUES (?,?,?,?)",
      userId,
      key,
      fingerprint,
      id,
    );
    await run(
      "INSERT INTO usage_events (id,user_id,created,units) VALUES (?,?,?,?)",
      id,
      userId,
      now,
      input.count,
    );
    const first =
      (await get<{ n: number }>(
        "SELECT COUNT(*) n FROM jobs WHERE session_id=?",
        input.sessionId,
      ))!.n === 1;
    if (first)
      await run(
        "UPDATE sessions SET updated=?,title=CASE WHEN title='Fresh canvas' OR title='Untitled session' THEN ? ELSE title END WHERE id=?",
        now,
        input.prompt.replace(/\s+/g, " ").slice(0, 55),
        input.sessionId,
      );
    else
      await run(
        "UPDATE sessions SET updated=? WHERE id=?",
        now,
        input.sessionId,
      );
    return (await get<Job>("SELECT * FROM jobs WHERE id=?", id))!;
  });
}
export async function claimJob(id?: string) {
  return transaction(async () => {
    await run(
      "UPDATE jobs SET status='failed',uncertain=1,error=?,finished=? WHERE status='generating' AND started<?",
      "This request was interrupted and may have been charged. It will not be retried automatically.",
      Date.now(),
      Date.now() - STALE_AFTER,
    );
    if (
      (await get<{ n: number }>(
        "SELECT COUNT(*) n FROM jobs WHERE status='generating'",
      ))!.n >= limits().concurrent
    )
      return;
    const job = id
      ? await get<Job>("SELECT * FROM jobs WHERE id=? AND status='queued'", id)
      : await get<Job>(
          "SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1",
        );
    if (!job) return;
    await run(
      "UPDATE jobs SET status='generating',started=? WHERE id=? AND status='queued'",
      Date.now(),
      job.id,
    );
    return { ...job, status: "generating" as const };
  });
}
export async function listJobs(userId: string, sessionId: string) {
  await ownSession(userId, sessionId);
  const jobs = await all<Job>(
    "SELECT * FROM jobs WHERE session_id=? AND user_id=? ORDER BY created",
    sessionId,
    userId,
  );
  const assets = await all<{ id: string; width: number; height: number }>(
    "SELECT id,width,height FROM assets WHERE session_id=? AND user_id=?",
    sessionId,
    userId,
  );
  return jobs.map((job) => {
    const ids = JSON.parse(job.results || "[]") as string[];
    if (!ids.length && job.result_id) ids.push(job.result_id);
    const outputs = ids
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is (typeof assets)[number] => Boolean(a));
    return {
      ...job,
      refs: JSON.parse(job.refs) as string[],
      outputs,
      width: outputs[0]?.width,
      height: outputs[0]?.height,
    };
  });
}
