import crypto from "node:crypto";

export const PBKDF2_ITERATIONS = 600000;

export function hashPassword(password, salt) {
  const effectiveSalt = salt || crypto.randomBytes(16).toString("hex");
  const digest = crypto
    .pbkdf2Sync(password, effectiveSalt, PBKDF2_ITERATIONS, 32, "sha256")
    .toString("hex");
  return `${effectiveSalt}$${digest}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes("$")) return false;
  const [salt, digest] = storedHash.split("$", 2);
  const computed = hashPassword(password, salt).split("$", 2)[1];
  return crypto.timingSafeEqual(Buffer.from(digest, "utf8"), Buffer.from(computed, "utf8"));
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}
