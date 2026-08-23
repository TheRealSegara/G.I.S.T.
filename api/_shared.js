// Request-identity helpers shared by _claudeHandler.js and _authHandler.js
// (both Node-style req/res handlers, used by both api/*.js on Vercel and
// server.js elsewhere). Kept separate from middleware.js's near-identical
// origin check, which runs on the Edge runtime against the Web Request
// API (different shape from Node's req/res) — that duplication is
// intentional defense-in-depth, not something to share code with.
import { ipAddress } from "@vercel/functions";

// Shared by _claudeHandler.js (enforces it) and _authHandler.js (reports
// it in the token response so the frontend's quota indicator knows the
// ceiling before any /api/claude call has happened yet). One definition
// so the two can never drift apart.
//
// Default is deliberately set just under Groq's real free-tier ceiling for
// openai/gpt-oss-20b: 200,000 tokens/day AND 1,000 requests/day, no billing
// linked — verify your own live numbers at console.groq.com/docs/rate-
// limits, they can differ by account and model. That's not the same as
// 200,000 / (some fixed token count) because different calls in this app
// cost very different amounts (a coach turn's ~1,800-1,900 tokens dwarfs a
// short student-answer retry), so this is a conservative estimate rounded
// down hard, not an exact division. Since the token/request ceiling is
// shared by the whole API key regardless of what we set here, going higher
// wouldn't unlock more real usage, it would just mean Groq's raw error
// shows up instead of ours.
//
// IMPORTANT if you run more than one access code (school) off the same
// Groq key: this limit is applied PER code, but Groq's 1,000 requests/day
// and 200,000 tokens/day ceilings are shared across ALL codes combined —
// this default assumes a single code. Running N codes at the default value
// can collectively exceed Groq's real ceiling well before any individual
// code hits its own limit; lower this value (e.g. ~100/N) via the env var
// if you have more than one access code configured. This is a meaningfully
// tighter budget than the old llama-3.1-8b-instant model this app used
// before Groq decommissioned it on 2026-08-16 (that model's free tier was
// 14,400 requests/day and 500,000 tokens/day — gpt-oss-20b's real-world
// ceiling is over 10x tighter on requests/day alone).
export const DAILY_QUOTA_PER_CODE = Number(process.env.DAILY_QUOTA_PER_CODE) || 100;

export function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Prefix-matching an allowed origin with a bare .startsWith() lets
// "https://your-app.vercel.app.evil.com" pass whenever
// "https://your-app.vercel.app" is allowed, since the shorter string really
// is a prefix of the longer one. Require either an exact match, or that the
// allowed origin is followed immediately by "/" (a path on the same
// origin/referer) — never a bareword continuation like ".evil.com" that
// turns it into a different host entirely. Kept in sync with the
// near-identical check in middleware.js (see that file's comment on why
// it's a separate implementation rather than a shared import).
function isOriginMatch(value, allowed) {
  if (!value || !value.startsWith(allowed)) return false;
  const nextChar = value.charAt(allowed.length);
  return nextChar === "" || nextChar === "/";
}

export function isOriginAllowed(req) {
  const allowed = getAllowedOrigins();
  if (allowed.length === 0) return true; // not configured yet: allow (see README)
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  return allowed.some((a) => isOriginMatch(origin, a) || isOriginMatch(referer, a));
}

// req.headers["x-forwarded-for"] is client-suppliable and must never be
// trusted directly, anyone can send a fake value and rotate it per
// request to defeat IP-keyed rate limiting / brute-force guards. On
// Vercel, ipAddress() reads "x-real-ip", which is set by Vercel's own
// edge network and can't be spoofed by the client. req.ip is the
// fallback for the Express path (server.js), which requires
// `app.set("trust proxy", ...)` (see server.js) so Express resolves the
// real client IP from its trusted proxy hop instead of raw client input.
export function getClientIp(req) {
  return ipAddress(new Headers(req.headers)) || req.ip || req.socket?.remoteAddress || "unknown";
}

// Opportunistically evicts expired entries from an in-memory rate-limit
// map once it grows past maxSize. Vercel serverless instances recycle
// before this matters, but server.js runs as one long-lived process, so
// without this the map would grow forever as distinct IPs/labels show up.
export function pruneIfLarge(map, maxSize, isExpired) {
  if (map.size <= maxSize) return;
  for (const [key, value] of map) {
    if (isExpired(value)) map.delete(key);
  }
}

// Sliding-window, per-key rate limiter. _claudeHandler.js, _authHandler.js,
// _studentAuthHandler.js, and _teacherRosterHandler.js each used to carry
// their own byte-for-byte copy of this (keyed by IP for most, by
// label+name for one extra guard in _studentAuthHandler.js) -- one
// implementation now, so a fix to the sliding-window logic itself can't
// silently apply to only some of them. Same best-effort, per-instance
// caveat as pruneIfLarge above: resets on each Vercel serverless cold
// start, only durable within one long-lived server.js process.
export function createRateLimiter(windowMs, maxRequests) {
  const log = new Map();
  return function check(key) {
    pruneIfLarge(log, 5000, (e) => Date.now() - e.windowStart > windowMs);
    const now = Date.now();
    const entry = log.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      log.set(key, { windowStart: now, count: 1 });
      return { limited: false, retryAfterMs: 0 };
    }
    entry.count += 1;
    const limited = entry.count > maxRequests;
    return { limited, retryAfterMs: limited ? Math.max(0, entry.windowStart + windowMs - now) : 0 };
  };
}

// Every token-consuming handler repeated this Authorization-header parse
// inline; centralized so there's one place that defines what a
// well-formed bearer header looks like.
export function getBearerToken(req) {
  const header = req.headers["authorization"] || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

// True if obj is a plain, non-array object containing only keys present
// in `allowedKeys`. Used to reject request bodies with extra/unexpected
// fields (OWASP API3: mass assignment / excessive data exposure) instead
// of silently ignoring fields the handler doesn't look at — an unused
// field today is a foothold for a bug tomorrow if the body is ever
// forwarded, logged, or spread into something else without this check.
export function isPlainObjectWithOnlyKeys(obj, allowedKeys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return Object.keys(obj).every((k) => allowedKeys.includes(k));
}
