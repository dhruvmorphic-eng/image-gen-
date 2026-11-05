import { sleep } from "workflow";
import { claimJob } from "../lib/jobs";
import { get, run, type Job } from "../lib/db";
import { executeJob } from "../lib/worker";
async function attempt(jobId: string) {
  "use step";
  console.log("Image job check", jobId);
  // Claim and dispatch are one non-retrying step. A second workflow cannot redispatch this job.
  const job = await claimJob(jobId);
  if (job) {
    await executeJob(job);
    return "done";
  }
  const existing = await get<Job>("SELECT * FROM jobs WHERE id=?", jobId);
  return existing?.status === "queued" || existing?.status === "generating"
    ? "waiting"
    : "done";
}
attempt.maxRetries = 0;
async function interrupted(jobId: string) {
  "use step";
  await run(
    "UPDATE jobs SET status='failed',uncertain=1,error=?,finished=? WHERE id=? AND status='generating'",
    "This request was interrupted and may have been charged. No automatic retry was made.",
    Date.now(),
    jobId,
  );
}
export async function generateImage(jobId: string) {
  "use workflow";
  try {
    for (let i = 0; i < 360; i++) {
      if ((await attempt(jobId)) === "done") return;
      await sleep("10s");
    }
  } catch {
    await interrupted(jobId);
  }
}
