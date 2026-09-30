import { timingSafeEqual, createHash } from "node:crypto";
export function sameSecret(value: string, expected: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(value), digest(expected));
}
export function validBasicAuth(
  header: string | null,
  user: string,
  password: string,
): boolean {
  if (!header?.startsWith("Basic ") || !user || !password) return false;
  const raw = Buffer.from(header.slice(6), "base64").toString("utf8"),
    colon = raw.indexOf(":");
  return (
    colon >= 0 &&
    sameSecret(raw.slice(0, colon), user) &&
    sameSecret(raw.slice(colon + 1), password)
  );
}
