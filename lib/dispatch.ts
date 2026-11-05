import { start } from "workflow/api";
import { generateImage } from "../workflows/generate";
import { get, run, transaction, type Job } from "./db";
export async function dispatchJob(id: string) {
  if (!process.env.VERCEL) return; // Local development uses the standalone worker.
  const claimed = await transaction(async () => {
    const job = await get<Job>("SELECT * FROM jobs WHERE id=?", id);
    if (
      !job ||
      job.status !== "queued" ||
      (job.dispatch_at && job.dispatch_at > Date.now() - 60000)
    )
      return false;
    await run("UPDATE jobs SET dispatch_at=? WHERE id=?", Date.now(), id);
    return true;
  });
  if (!claimed) return;
  try {
    await start(generateImage, [id]);
  } catch {
    await run(
      "UPDATE jobs SET dispatch_at=NULL WHERE id=? AND status='queued'",
      id,
    );
    throw new Error(
      "The background queue could not be reached. Your request is saved; reopen the canvas to resume dispatch.",
    );
  }
}
