// Shared handler for issuing short-lived access tokens after validating a
// teacher/school access code. Used by both api/auth.js (Vercel serverless
// function) and server.js (Cloud Run / generic Node hosting), same split
// as _claudeHandler.js.
//
// This is a lightweight access gate, not a full account system: codes are
// shared secrets distributed to teachers/schools, not per-user logins. The
// goal is keeping random internet traffic off the Groq proxy and daily
// quota, not protecting student data — student accounts and session
// results are a separate, per-student auth layer (see _studentAuth.js /
// _studentAuthHandler.js / _sessionHandler.js) with its own access checks.

import crypto from "node:crypto";
import { signToken } from "./_auth.js";
import { isOriginAllowed, getClientIp, isPlainObjectWithOnlyKeys, createRateLimiter, DAILY_QUOTA_PER_CODE } from "./_shared.js";

// Constant-time string compare, same approach as the HMAC check in
// _auth.js -- a plain === here would let response timing leak how many
// leading characters of a guess matched the real code.
function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// The exact, complete shape the access-code screen in App.jsx is allowed
// to send. Anything outside this is rejected outright, not ignored.
const ALLOWED_BODY_KEYS = ["code"];

const TOKEN_TTL_MINUTES = Number(process.env.TOKEN_TTL_MINUTES) || 720; // 12h: a school day plus margin
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 60_000;
// Best-effort per-instance brute-force guard on code attempts, same
// caveats as the rate limiter in _claudeHandler.js (resets per instance).
const checkBruteForce = createRateLimiter(ATTEMPT_WINDOW_MS, MAX_ATTEMPTS);

// ACCESS_CODES format: "code1:Label One,code2:Label Two". Label is
// optional and defaults to the code itself; it's what per-code quota
// tracking and future auditing key off, not the raw secret.
function getAccessCodes() {
  return (process.env.ACCESS_CODES || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [code, label] = entry.split(":").map((s) => s.trim());
      return { code, label: label || code };
    })
    .filter((c) => c.code);
}

// Best-effort per-instance brute-force guard on code attempts, same
// caveats as the rate limiter in _claudeHandler.js (resets per instance).
function isBruteForceBlocked(ip) {
  pruneIfLarge(attemptLog, 5000, (e) => Date.now() - e.windowStart > ATTEMPT_WINDOW_MS);
  const now = Date.now();
  const entry = attemptLog.get(ip);
  if (!entry || now - entry.windowStart > ATTEMPT_WINDOW_MS) {
    attemptLog.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export default async function authHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isOriginAllowed(req)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const ip = getClientIp(req);
  if (checkBruteForce(ip).limited) {
    return res.status(429).json({ error: "Too many attempts, please wait a minute and try again" });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Server is missing AUTH_SECRET" });
  }

  const codes = getAccessCodes();
  if (codes.length === 0) {
    return res.status(500).json({ error: "Server is missing ACCESS_CODES" });
  }

  if (!isPlainObjectWithOnlyKeys(req.body, ALLOWED_BODY_KEYS)) {
    return res.status(400).json({ error: "Missing or unexpected fields in request body" });
  }

  const submitted = typeof req.body.code === "string" ? req.body.code.trim() : "";
  if (!submitted || submitted.length > 100) {
    return res.status(400).json({ error: "Missing access code" });
  }

  const match = codes.find((c) => timingSafeStringEqual(c.code, submitted));
  if (!match) {
    return res.status(401).json({ error: "Invalid access code" });
  }

  const exp = Date.now() + TOKEN_TTL_MINUTES * 60_000;
  const token = signToken({ kind: "teacher", label: match.label, exp }, secret);
  // dailyLimit lets the frontend show/estimate a quota indicator before
  // any /api/claude call has happened yet this session; the authoritative
  // used/remaining counts come from each /api/claude response itself.
  return res.status(200).json({ token, expiresAt: exp, dailyLimit: DAILY_QUOTA_PER_CODE });
}
