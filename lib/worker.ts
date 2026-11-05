import OpenAI, { toFile } from "openai";
import type {
  ImageEditParamsNonStreaming,
  ImageGenerateParamsNonStreaming,
} from "openai/resources/images";
import { hash } from "./auth";
import { REQUEST_TIMEOUT } from "./config";
import { get, run, transaction, type Job, type Asset } from "./db";
import { inspectImage, saveAsset } from "./images";
export function publicFailure(error: unknown) {
  const e = error as { status?: number; code?: string; name?: string };
  if (
    e.code === "insufficient_quota" ||
    e.code === "billing_hard_limit_reached"
  )
    return {
      message:
        "The OpenAI project has insufficient credits. Ask your administrator to check billing.",
      uncertain: false,
    };
  if (e.status === 429)
    return {
      message:
        "OpenAI is rate limiting this project. Wait before starting a new request.",
      uncertain: false,
    };
  if (e.status === 401 || e.status === 403 || e.status === 404)
    return {
      message:
        "The OpenAI project cannot access this model or its API key is invalid. Ask your administrator to check access. The model was not changed.",
      uncertain: false,
    };
  if (e.status === 400 || e.status === 422)
    return {
      message:
        "OpenAI could not process this prompt or its references. Review your inputs and try a new request.",
      uncertain: false,
    };
  return {
    message:
      "The generation did not finish reliably. It may have been charged. No automatic retry was made; check with your administrator before generating again.",
    uncertain: true,
  };
}
export async function executeJob(job: Job, client?: OpenAI) {
  let responseReceived = false;
  try {
    const api =
      client ||
      new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        maxRetries: 0,
        timeout: REQUEST_TIMEOUT,
      });
    const refs = await Promise.all(
      (JSON.parse(job.refs) as string[]).map((id) =>
        get<Asset>(
          "SELECT * FROM assets WHERE id=? AND user_id=?",
          id,
          job.user_id,
        ),
      ),
    );
    if (refs.some((ref) => !ref)) throw new Error("Missing saved reference");
    // SDK string unions can lag new model releases; validation uses our server allowlist.
    const params = {
      model: job.model,
      prompt: job.prompt,
      n: job.count || 1,
      quality: job.quality,
      size: job.size,
      output_format: "png",
      user: hash(job.user_id),
    };
    const result = refs.length
      ? await api.images.edit(
          {
            ...params,
            image: await Promise.all(
              refs.map((ref, i) =>
                toFile(
                  Buffer.from(ref!.bytes),
                  `reference-${i + 1}.${ref!.mime.split("/")[1]}`,
                  { type: ref!.mime },
                ),
              ),
            ),
          } as ImageEditParamsNonStreaming,
          { maxRetries: 0, timeout: REQUEST_TIMEOUT },
        )
      : await api.images.generate(params as ImageGenerateParamsNonStreaming, {
          maxRetries: 0,
          timeout: REQUEST_TIMEOUT,
        });
    responseReceived = true;
    const outputs = await Promise.all(
      (result.data || []).map(async (item) => {
        if (!item.b64_json) throw new Error("No image returned");
        const bytes = Buffer.from(item.b64_json, "base64");
        return { bytes, meta: await inspectImage(bytes, 50 * 1024 * 1024) };
      }),
    );
    if (!outputs.length) throw new Error("No images returned");
    await transaction(async () => {
      if (
        (await get<Job>("SELECT * FROM jobs WHERE id=?", job.id))?.status !==
        "generating"
      )
        return;
      const ids: string[] = [];
      for (const output of outputs)
        ids.push(
          (
            await saveAsset(
              job.user_id,
              job.session_id,
              output.bytes,
              output.meta,
            )
          ).id,
        );
      await run(
        "UPDATE jobs SET status='completed',result_id=?,results=?,finished=? WHERE id=?",
        ids[0],
        JSON.stringify(ids),
        Date.now(),
        job.id,
      );
      await run(
        "UPDATE sessions SET updated=? WHERE id=?",
        Date.now(),
        job.session_id,
      );
    });
  } catch (error) {
    const failure = publicFailure(error);
    const message = responseReceived
      ? "OpenAI returned a result, but saving it failed. This request may have been charged. No automatic retry was made. Check available storage."
      : failure.message;
    await run(
      "UPDATE jobs SET status='failed',error=?,uncertain=?,finished=? WHERE id=? AND status='generating'",
      message,
      responseReceived || failure.uncertain ? 1 : 0,
      Date.now(),
      job.id,
    );
    // Deliberately do not log provider errors: they can contain prompts and secrets.
  }
}
