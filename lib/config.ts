// Server-owned single-model configuration, verified against the official Images API.
export const MODELS = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    sizes: [
      { value: "1024x1024", label: "Square", ratio: "1:1" },
      { value: "1024x1536", label: "Portrait", ratio: "2:3" },
      { value: "1536x1024", label: "Landscape", ratio: "3:2" },
      { value: "1536x864", label: "Widescreen", ratio: "16:9" },
      { value: "864x1536", label: "Vertical", ratio: "9:16" },
    ],
    qualities: ["medium", "high"],
    maxReferences: 4,
  },
];
export function positiveEnv(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid ${name}`);
  return value;
}
export const limits = () => ({
  daily: positiveEnv("USER_DAILY_LIMIT", 30),
  globalDaily: positiveEnv("GLOBAL_DAILY_LIMIT", 100),
  concurrent: positiveEnv("MAX_CONCURRENT_JOBS", 2),
  pending: positiveEnv("USER_PENDING_LIMIT", 3),
  storage: positiveEnv("USER_STORAGE_MB", 1024) * 1024 * 1024,
});
// Below Vercel's 4.5 MB request limit. Browser uploads one reference per request.
export const MAX_UPLOAD = 4 * 1024 * 1024;
export const MAX_PIXELS = 16_777_216;
export const REQUEST_TIMEOUT = 240_000;
export const STALE_AFTER = REQUEST_TIMEOUT + 120_000;
