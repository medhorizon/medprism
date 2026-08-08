import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.mjs";

export function nowIso() {
  return new Date().toISOString();
}

export function addSecondsIso(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function newId(prefix) {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function hashValue(value) {
  return createHash("sha256")
    .update(`${env.tokenSecret}:${value}`)
    .digest("hex");
}

export function safeEqualHex(a, b) {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function randomOtpCode() {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}
