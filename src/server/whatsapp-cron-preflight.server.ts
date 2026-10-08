import { createHash } from "node:crypto";
import { checkRateLimit, type CheckRateLimitOptions, type CheckRateLimitResult } from "./rate-limit.server";

/** HMAC is checked by caller first. The signed JSON contains epoch seconds and
 * a unique nonce. Atomic, shared rate_limit_hit prevents cross-worker replay.
 */
export async function cronPreflight(raw: string, route: string, deps: {
  now?: () => number; hit?: (options: CheckRateLimitOptions) => Promise<CheckRateLimitResult>;
} = {}): Promise<"ok" | "invalid" | "replay" | "unavailable"> {
  let body: {timestamp?: unknown; nonce?: unknown};
  try { body=JSON.parse(raw); } catch { return "invalid"; }
  const now=deps.now?.() ?? Date.now();
  if (typeof body.timestamp !== "number" || !Number.isInteger(body.timestamp) ||
    Math.abs(now/1000-body.timestamp)>120 || typeof body.nonce !== "string" ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(body.nonce)) return "invalid";
  const hit=deps.hit ?? checkRateLimit;
  const nonce=createHash("sha256").update(body.nonce).digest("hex");
  const replay=await hit({key:`wa-cron:${route}:${nonce}`,route,limit:1,windowSeconds:300});
  if (replay.dbError) return "unavailable";
  if (replay.blocked) return "replay";
  const rate=await hit({key:`wa-cron-rate:${route}`,route,limit:2,windowSeconds:60});
  if (rate.dbError) return "unavailable";
  return rate.blocked ? "replay" : "ok";
}

export async function readCronBody(request: Request): Promise<string | null> {
  const reader=request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[]=[]; let count=0;
  try {
    while(true) {
      const {done,value}=await reader.read(); if(done) break;
      count+=value.byteLength;
      if(count>4096) {await reader.cancel(); return null;}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const result=new Uint8Array(count);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(result);
}
