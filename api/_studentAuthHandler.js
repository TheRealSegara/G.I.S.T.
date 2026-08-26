// Shared handler for student sign-up and login, used by both
// api/student-auth.js (Vercel) and server.js. Requires a valid
// teacher-level token (issued by /api/auth after a correct access code),
// so student accounts only exist inside an already-unlocked device/session
// and are scoped to that access code's label — two schools can each have a
// student named "Ahmad" without collision, and one school can't see
// another's roster.
//
// Identification is by full name alone, deliberately: this is a
// supervised-classroom tool for tracking progress, not a security boundary
// against a determined attacker, and the DB's unique (access_code_label,
// full_name_key) index already means no two students under the same code
// can collide. The rate limit below guards against automated abuse, not
// credential guessing — there's no credential to guess.

import { verifyToken, signToken } from "./_auth.js";
import { isOriginAllowed, getClientIp, isPlainObjectWithOnlyKeys, createRateLimiter, getBearerToken } from "./_shared.js";
import { getSupabase } from "./_supabase.js";
import { normalizeName, isValidFullName, isValidAvatarConfig } from "./_studentAuth.js";

const ALLOWED_BODY_KEYS = ["mode", "fullName", "avatarConfig"];
const TOKEN_TTL_MINUTES = Number(process.env.TOKEN_TTL_MINUTES) || 720;

// Shared with signup and login: a classroom of students authenticating in
// the same minute from the same NAT/IP is normal, so this is generous
// compared to the teacher-code guard, but still stops automated abuse.
const MAX_ATTEMPTS = 30;
const ATTEMPT_WINDOW_MS = 60_000;
const checkRateLimit = createRateLimiter(ATTEMPT_WINDOW_MS, MAX_ATTEMPTS);

export default async function studentAuthHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isOriginAllowed(req)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const ip = getClientIp(req);
  if (checkRateLimit(ip).limited) {
    return res.status(429).json({ error: "Too many attempts, please wait a minute and try again" });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Server is missing AUTH_SECRET" });
  }

  const teacherToken = getBearerToken(req);
  const claims = verifyToken(teacherToken, secret);
  if (!claims || claims.kind === "student") {
    // tokenInvalid distinguishes this from the OTHER error this same
    // endpoint returns below (name not found on login, a 404) — the client
    // (App.jsx's apiRequest) relies on this flag to decide whether to show
    // "your class session expired, re-enter the code" — it must never fire
    // on a student simply mistyping their name, which would otherwise look
    // identical (same teacher token either way, since student signup/login
    // always authenticates with the teacher token, not a student token —
    // there isn't one yet).
    return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: "Server is missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" });
  }

  if (!isPlainObjectWithOnlyKeys(req.body, ALLOWED_BODY_KEYS)) {
    return res.status(400).json({ error: "Missing or unexpected fields in request body" });
  }

  const { mode, fullName, avatarConfig } = req.body;
  if (mode !== "signup" && mode !== "login") {
    return res.status(400).json({ error: "Invalid mode" });
  }

  if (!isValidFullName(fullName)) {
    return res.status(400).json({ error: "Please enter a valid name" });
  }

  const nameKey = normalizeName(fullName);

  if (mode === "signup") {
    if (!isValidAvatarConfig(avatarConfig)) {
      return res.status(400).json({ error: "Invalid avatar" });
    }
    const { data: existing, error: lookupError } = await supabase
      .from("students")
      .select("id")
      .eq("access_code_label", claims.label)
      .eq("full_name_key", nameKey)
      .maybeSingle();
    if (lookupError) {
      return res.status(502).json({ error: "Couldn't reach the database, please try again" });
    }
    if (existing) {
      return res.status(409).json({ error: "That name is already registered. Try Returning Student instead." });
    }

    const { data: created, error: insertError } = await supabase
      .from("students")
      .insert({
        access_code_label: claims.label,
        full_name: fullName.trim(),
        full_name_key: nameKey,
        avatar_config: avatarConfig,
      })
      .select("id, full_name, avatar_config")
      .single();
    if (insertError || !created) {
      return res.status(502).json({ error: "Couldn't create the account, please try again" });
    }

    const exp = Date.now() + TOKEN_TTL_MINUTES * 60_000;
    const token = signToken({ kind: "student", studentId: created.id, label: claims.label, exp }, secret);
    return res.status(200).json({
      token,
      expiresAt: exp,
      student: { id: created.id, fullName: created.full_name, avatarConfig: created.avatar_config },
    });
  }

  // mode === "login"
  const { data: student, error: lookupError } = await supabase
    .from("students")
    .select("id, full_name, avatar_config")
    .eq("access_code_label", claims.label)
    .eq("full_name_key", nameKey)
    .maybeSingle();
  if (lookupError) {
    return res.status(502).json({ error: "Couldn't reach the database, please try again" });
  }
  // studentNotFound lets the client tell "this name isn't registered yet"
  // apart from other errors, so it can point a new student at Sign Up
  // instead of just showing a dead-end message.
  if (!student) {
    return res.status(404).json({ error: "That name isn't registered yet. Try New Student instead.", studentNotFound: true });
  }

  await supabase.from("students").update({ last_login_at: new Date().toISOString() }).eq("id", student.id);

  const exp = Date.now() + TOKEN_TTL_MINUTES * 60_000;
  const token = signToken({ kind: "student", studentId: student.id, label: claims.label, exp }, secret);
  return res.status(200).json({
    token,
    expiresAt: exp,
    student: { id: student.id, fullName: student.full_name, avatarConfig: student.avatar_config },
  });
}
