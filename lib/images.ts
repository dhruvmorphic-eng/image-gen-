import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { MAX_UPLOAD, MAX_PIXELS, limits } from "./config";
import { get, run, transaction } from "./db";
import { HttpError } from "./auth";
export async function inspectImage(bytes: Buffer, maxBytes = MAX_UPLOAD) {
  if (!bytes.length || bytes.length > maxBytes)
    throw new HttpError(
      400,
      `Images must be no larger than ${maxBytes / 1024 / 1024} MB.`,
    );
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
      failOn: "warning",
    });
    const meta = await image.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1 ||
      !meta.width ||
      !meta.height
    )
      throw new Error("Unsupported image");
    // Decode fully: metadata alone can accept truncated or malicious payloads.
    await image.stats();
    return {
      mime: `image/${meta.format}`,
      width: meta.width,
      height: meta.height,
    };
  } catch {
    throw new HttpError(
      400,
      "Use a valid, still PNG, JPEG, or WebP image with at most 16 megapixels.",
    );
  }
}
export async function saveAsset(
  userId: string,
  sessionId: string,
  bytes: Buffer,
  meta: { mime: string; width: number; height: number },
) {
  const used = (await get<{ n: number }>(
    "SELECT COALESCE(SUM(length(bytes)),0) n FROM assets WHERE user_id=?",
    userId,
  ))!.n;
  if (used + bytes.length > limits().storage)
    throw new HttpError(
      429,
      "Your image storage limit has been reached. Delete an old session to free space.",
    );
  const id = randomUUID();
  await run(
    "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)",
    id,
    userId,
    sessionId,
    meta.mime,
    meta.width,
    meta.height,
    bytes,
    Date.now(),
  );
  return { id, ...meta };
}
export async function storeUpload(
  userId: string,
  sessionId: string,
  bytes: Buffer,
) {
  const meta = await inspectImage(bytes);
  return transaction(() => saveAsset(userId, sessionId, bytes, meta));
}
