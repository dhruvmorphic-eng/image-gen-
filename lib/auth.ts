import { randomBytes, randomUUID, createHash } from "node:crypto";
import { get, run, transaction, type User } from "./db";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const YEAR = 365 * 86400;
export async function authenticate(request: Request) {
  const token = /(?:^|;\s*)studio_session=([^;]+)/.exec(
    request.headers.get("cookie") || "",
  )?.[1];
  const user =
    token &&
    (await get<User>(
      "SELECT u.* FROM users u JOIN auth a ON u.id=a.user_id WHERE a.token=? AND a.expires>? AND u.active=1",
      hash(token),
      Date.now(),
    ));
  if (!user)
    throw new HttpError(
      401,
      "Reopen the studio to reconnect your browser workspace.",
    );
  return user;
}
export function sameOrigin(request: Request) {
  const allowed = new Set(
    [
      process.env.APP_ORIGIN,
      process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
      process.env.VERCEL_PROJECT_PRODUCTION_URL &&
        `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    ].filter(Boolean),
  );
  if (!allowed.size && !process.env.VERCEL)
    allowed.add("http://localhost:3000");
  if (!allowed.has(request.headers.get("origin") || ""))
    throw new HttpError(403, "This request must come from Image Studio.");
}
export function cookie(token: string) {
  return `studio_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${YEAR}${process.env.VERCEL || process.env.APP_ORIGIN?.startsWith("https://") ? "; Secure" : ""}`;
}
export async function bootstrap(request: Request) {
  try {
    return { user: await authenticate(request), cookie: null };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
  }
  // A capability cookie replaces the login UI. It never grants access to another browser's data.
  return transaction(async () => {
    const id = randomUUID(),
      token = randomBytes(32).toString("hex");
    await run(
      "INSERT INTO users (id,email,password,active) VALUES (?,?,?,1)",
      id,
      `${id}@browser.local`,
      "browser-only",
    );
    await run(
      "INSERT INTO auth VALUES (?,?,?)",
      hash(token),
      id,
      Date.now() + YEAR * 1000,
    );
    return {
      user: { id, email: "Your workspace", password: "", active: 1 },
      cookie: cookie(token),
    };
  });
}
