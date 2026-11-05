import "dotenv/config";
import { claimJob } from "../lib/jobs";
import { executeJob } from "../lib/worker";
import { run } from "../lib/db";
const active = new Set<Promise<void>>();
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
console.log(
  "Image Studio worker started. Automatic paid-request retries are disabled.",
);
async function main() {
  while (!stopping) {
    if (process.env.OPENAI_API_KEY) {
      await run(
        "INSERT INTO worker_health VALUES (1,?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen",
        Date.now(),
      );
      const job = await claimJob();
      if (job) {
        const task = executeJob(job).finally(() => active.delete(task));
        active.add(task);
        continue;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await Promise.allSettled(active);
}
main().catch(() => {
  console.error(
    "Worker stopped unexpectedly. Check database access and configuration.",
  );
  process.exitCode = 1;
});
