import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type OpenAI from "openai";
const dir = mkdtempSync(join(tmpdir(), "studio-test-"));
process.env.DATABASE_PATH = join(dir, "test.sqlite");
process.env.APP_ORIGIN = "http://localhost:3000";
process.env.USER_DAILY_LIMIT = "30";
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
const { get, run, closeDatabase } = await import("../lib/db");
const { bootstrap, authenticate } = await import("../lib/auth");
const { enqueue, claimJob, ownAsset, listJobs } = await import("../lib/jobs");
const { inspectImage, storeUpload } = await import("../lib/images");
const { executeJob, publicFailure } = await import("../lib/worker");
const { GET, POST, PATCH, DELETE } = await import("../app/api/[...path]/route");
let alice = "",
  bob = "",
  token = "",
  bobToken = "",
  image: Buffer;
const sid = randomUUID(),
  other = randomUUID();
function input(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: sid,
    key: randomUUID(),
    prompt: "A ceramic vessel",
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "medium",
    count: 1,
    refs: [],
    parentId: null,
    ...overrides,
  };
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  auth = token,
  origin = "http://localhost:3000",
) {
  const req = new Request(`http://localhost:3000/api/${path}`, {
    method,
    headers: { origin, ...(auth ? { cookie: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const handler =
    method === "POST"
      ? POST
      : method === "PATCH"
        ? PATCH
        : method === "DELETE"
          ? DELETE
          : GET;
  return handler(req, { params: Promise.resolve({ path: path.split("/") }) });
}
before(async () => {
  const a = await bootstrap(new Request("http://localhost"));
  const b = await bootstrap(new Request("http://localhost"));
  alice = a.user.id;
  bob = b.user.id;
  token = a.cookie!.split(";")[0];
  bobToken = b.cookie!.split(";")[0];
  for (const [id, user] of [
    [sid, alice],
    [other, bob],
  ])
    await run(
      "INSERT INTO sessions VALUES (?,?,?,?,?)",
      id,
      user,
      "Fresh canvas",
      Date.now(),
      Date.now(),
    );
  image = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#ccc" },
  })
    .png()
    .toBuffer();
});
after(async () => {
  await closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});
test("browser bootstrap requires no login and retains the same private owner", async () => {
  const response = await request("bootstrap", "POST");
  const data = await response.json();
  assert.equal(data.user.id, alice);
  assert.equal(data.models.length, 1);
  assert.equal(data.models[0].id, "gpt-image-2");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await request("login", "POST", {})).status, 404);
});
test("all private endpoints require a workspace capability cookie", async () => {
  for (const [path, method] of [
    ["me", "GET"],
    ["sessions", "GET"],
    ["sessions", "POST"],
    [`sessions/${sid}`, "GET"],
    [`sessions/${sid}`, "PATCH"],
    [`sessions/${sid}`, "DELETE"],
    ["jobs", "POST"],
    ["assets", "POST"],
    [`assets/${randomUUID()}`, "GET"],
  ])
    assert.equal(
      (await request(path, method, method === "GET" ? undefined : {}, ""))
        .status,
      401,
    );
});
test("CSRF blocks bootstrap and other writes", async () => {
  assert.equal(
    (await request("bootstrap", "POST", {}, "", "https://evil.example")).status,
    403,
  );
  assert.equal(
    (await request("sessions", "POST", {}, token, "https://evil.example"))
      .status,
    403,
  );
});
test("cross-browser canvas access and mutations are denied", async () => {
  for (const method of ["GET", "PATCH", "DELETE"])
    assert.equal(
      (
        await request(
          `sessions/${other}`,
          method,
          method === "GET" ? undefined : { title: "intrusion" },
        )
      ).status,
      404,
    );
  await assert.rejects(
    enqueue(alice, input({ sessionId: other })),
    /Canvas not found/,
  );
});
test("uploads decode safely and private downloads preserve original bytes", async () => {
  const asset = await storeUpload(alice, sid, image);
  await assert.rejects(ownAsset(bob, asset.id), /Image not found/);
  const response = await request(`assets/${asset.id}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  assert.equal(
    (await request(`assets/${asset.id}`, "GET", undefined, bobToken)).status,
    404,
  );
  await assert.rejects(inspectImage(Buffer.from('<svg onload="evil()"/>')));
  await assert.rejects(inspectImage(Buffer.alloc(5 * 1024 * 1024)));
});
test("simultaneous duplicate submissions create exactly one job and quota event", async () => {
  const payload = input();
  const jobs = await Promise.all(
    Array.from({ length: 8 }, () => enqueue(alice, payload)),
  );
  assert.equal(new Set(jobs.map((j) => j.id)).size, 1);
  assert.equal(
    (await get<{ n: number }>(
      "SELECT COUNT(*) n FROM usage_events WHERE id=?",
      jobs[0].id,
    ))!.n,
    1,
  );
  await assert.rejects(
    enqueue(alice, { ...payload, prompt: "Changed" }),
    /already used/,
  );
  await run("UPDATE jobs SET status='failed' WHERE id=?", jobs[0].id);
});
test("single model, quality, count, and shape are validated on the server", async () => {
  for (const patch of [
    { model: "gpt-image-2.5-flare" },
    { quality: "max" },
    { count: 5 },
    { size: "1921x1080" },
    { refs: Array.from({ length: 5 }, () => randomUUID()) },
  ])
    await assert.rejects(enqueue(alice, input(patch)));
});
test("foreign references and invalid edit parents are rejected", async () => {
  const asset = await storeUpload(bob, other, image);
  await assert.rejects(
    enqueue(alice, input({ refs: [asset.id] })),
    /Image not found/,
  );
  await assert.rejects(
    enqueue(alice, input({ parentId: randomUUID() })),
    /selected edit image/,
  );
});
test("concurrent workers cannot exceed the global limit; stale jobs never requeue", async () => {
  const a = await enqueue(alice, input()),
    b = await enqueue(alice, input());
  const claimed = await Promise.all([claimJob(), claimJob(), claimJob()]);
  assert.equal(claimed.filter(Boolean).length, 2);
  await run("UPDATE jobs SET started=0 WHERE id IN (?,?)", a.id, b.id);
  assert.equal(await claimJob(), undefined);
  const stale = (await get<{ status: string; uncertain: number }>(
    "SELECT * FROM jobs WHERE id=?",
    a.id,
  ))!;
  assert.equal(stale.status, "failed");
  assert.equal(stale.uncertain, 1);
});
test("one request can save multiple originals and edit a selected non-first result", async () => {
  let calls = 0;
  const client = {
    images: {
      generate: async (
        params: { n: number },
        options: { maxRetries: number },
      ) => {
        calls++;
        assert.equal(params.n, 3);
        assert.equal(options.maxRetries, 0);
        return {
          data: Array.from({ length: 3 }, () => ({
            b64_json: image.toString("base64"),
          })),
        };
      },
      edit: async (
        params: { prompt: string; image: File[] },
        options: { maxRetries: number },
      ) => {
        calls++;
        assert.equal(params.prompt, "Make it matte");
        assert.equal(params.image.length, 1);
        assert.equal(options.maxRetries, 0);
        return { data: [{ b64_json: image.toString("base64") }] };
      },
    },
  } as unknown as OpenAI;
  const job = await enqueue(alice, input({ count: 3 }));
  await executeJob((await claimJob())!, client);
  const result = (await get<{ results: string; status: string }>(
    "SELECT * FROM jobs WHERE id=?",
    job.id,
  ))!;
  assert.equal(result.status, "completed");
  const ids = JSON.parse(result.results);
  assert.equal(ids.length, 3);
  assert.deepEqual(Buffer.from((await ownAsset(alice, ids[1])).bytes), image);
  await enqueue(
    alice,
    input({ prompt: "Make it matte", refs: [ids[1]], parentId: job.id }),
  );
  await executeJob((await claimJob())!, client);
  assert.equal(calls, 2);
  assert.ok(await ownAsset(alice, ids[1]));
  const history = await listJobs(alice, sid);
  assert.equal(history.find((j) => j.id === job.id)!.outputs.length, 3);
});
test("uncertain provider timeout is not retried or exposed verbatim", async () => {
  let calls = 0;
  const client = {
    images: {
      generate: async () => {
        calls++;
        throw new Error("timeout secret");
      },
    },
  } as unknown as OpenAI;
  const job = await enqueue(alice, input());
  await executeJob((await claimJob())!, client);
  assert.equal(calls, 1);
  const failed = (await get<{
    status: string;
    error: string;
    uncertain: number;
  }>("SELECT * FROM jobs WHERE id=?", job.id))!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.uncertain, 1);
  assert.doesNotMatch(failed.error, /secret/);
  assert.equal(await claimJob(), undefined);
});
test("image-based daily quotas survive deleting a canvas", async () => {
  const disposable = randomUUID();
  await run(
    "INSERT INTO sessions VALUES (?,?,?,?,?)",
    disposable,
    alice,
    "Fresh canvas",
    Date.now(),
    Date.now(),
  );
  const before = (await get<{ n: number }>(
    "SELECT SUM(units) n FROM usage_events WHERE user_id=?",
    alice,
  ))!.n;
  const job = await enqueue(alice, input({ sessionId: disposable, count: 2 }));
  await run("UPDATE jobs SET status='failed' WHERE id=?", job.id);
  await run("DELETE FROM sessions WHERE id=?", disposable);
  process.env.USER_DAILY_LIMIT = String(before + 2);
  await assert.rejects(enqueue(alice, input()), /image limit/);
  process.env.USER_DAILY_LIMIT = "30";
});
test("global quota stops cookie resets from creating unlimited paid requests", async () => {
  process.env.GLOBAL_DAILY_LIMIT = "1";
  await assert.rejects(
    enqueue(bob, input({ sessionId: other })),
    /studio has reached/,
  );
  delete process.env.GLOBAL_DAILY_LIMIT;
});
test("provider failures are helpful and never switch models", () => {
  assert.match(
    publicFailure({ code: "insufficient_quota" }).message,
    /credits/,
  );
  assert.match(publicFailure({ status: 429 }).message, /rate limiting/);
  assert.match(publicFailure({ status: 403 }).message, /access/);
});
test("missing API credentials leaves inputs saved and reports setup required", async () => {
  delete process.env.OPENAI_API_KEY;
  const response = await request("jobs", "POST", input());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /API key/);
});
test("workspace revocation invalidates its browser cookie", async () => {
  await run("UPDATE users SET active=0 WHERE id=?", alice);
  await assert.rejects(
    authenticate(
      new Request("http://localhost", { headers: { cookie: token } }),
    ),
    /Reopen/,
  );
});
