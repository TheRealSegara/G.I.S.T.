// Shared handler for saving and reading a session (one passage attempt),
// used by both api/session.js (Vercel) and server.js.
//
// POST: a student saves their own just-finished session (student token).
// GET: a teacher reads a specific past session's full log, gated by
//   ownership (the session's student must belong to the requesting
//   teacher token's access_code_label, so a guessed/leaked session UUID
//   from another school reveals nothing).
// PATCH: a teacher caches the AI-generated diagnostic report against a
//   session they already fetched, so reopening it later in the File Box
//   doesn't re-spend AI quota regenerating the same summary.

import { verifyToken } from "./_auth.js";
import { isOriginAllowed, getClientIp, isPlainObjectWithOnlyKeys, createRateLimiter, getBearerToken } from "./_shared.js";
import { getSupabase } from "./_supabase.js";

const MAX_WORDS_PER_SESSION = 10; // generous margin over SESSION_WORD_COUNT (5)
const MAX_STRING = 500;

const SAVE_ALLOWED_KEYS = ["passageTitle", "passageEmoji", "startedAt", "finishedAt", "comprehensionResult", "log"];
const LOG_ENTRY_ALLOWED_KEYS = [
  "word", "clueType", "concreteness", "finalStage", "hintsUsed", "skipped", "skipReason", "revealedMeaning",
  "priorKnowledge", "gotItVia", "clueIdentified", "transferPassed", "timeToAnswerSec", "minGateSec", "solvedAt", "passageTitle", "funFact",
];
const PATCH_ALLOWED_KEYS = ["sessionId", "diagnosticReport", "teacherNotes"];

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const checkRateLimit = createRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);

function isValidShortString(v, max = MAX_STRING) {
  return typeof v === "string" && v.length <= max;
}

// Same as isValidShortString but also accepts the field being absent
// entirely, for the many log-entry fields that are optional (e.g. a
// skipped word has no gotItVia/clueIdentified).
function isValidOptionalString(v, max) {
  return v === undefined || v === null || isValidShortString(v, max);
}

function isValidOptionalBoolean(v) {
  return v === undefined || v === null || typeof v === "boolean";
}

function isValidOptionalNumber(v) {
  return v === undefined || v === null || (typeof v === "number" && Number.isFinite(v));
}

function isValidTimestamp(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

// Short, enum-like fields (clueType: contrast/definition/example/inference,
// concreteness: abstract/concrete, priorKnowledge: yes/no/not_sure,
// gotItVia: knew/clues/guessed) — the model/app only ever writes one of a
// handful of short words here, so a generous 100-char cap is plenty and
// still blocks anyone from stuffing something huge into these columns.
const MAX_ENUM_LIKE = 100;
// Free-text fields the AI coach fills in per turn (see buildCoachSystemPrompt
// in src/App.jsx: "message" is capped at ~2 short sentences, fun_fact is a
// short reward line) — 1000 chars is a generous margin over what the coach
// actually produces, not a field meant to hold arbitrary long text.
const MAX_FREE_TEXT = 1000;
// clueIdentified is a short phrase from the passage the student tapped, not
// a full free-text field, but can run a bit longer than a bare enum value.
const MAX_CLUE_PHRASE = 500;

function validateComprehensionResult(c) {
  if (c === null || c === undefined) return true;
  if (typeof c !== "object" || Array.isArray(c)) return false;
  const keys = ["ran", "correct", "question", "studentAnswer", "correctAnswer"];
  if (!Object.keys(c).every((k) => keys.includes(k))) return false;
  if (typeof c.ran !== "boolean") return false;
  if (!isValidOptionalBoolean(c.correct)) return false;
  if (!isValidOptionalString(c.question, MAX_STRING)) return false;
  if (!isValidOptionalString(c.studentAnswer, MAX_STRING)) return false;
  if (!isValidOptionalString(c.correctAnswer, MAX_STRING)) return false;
  return true;
}

function validateLogEntry(entry) {
  if (!isPlainObjectWithOnlyKeys(entry, LOG_ENTRY_ALLOWED_KEYS)) return false;
  if (!isValidShortString(entry.word, 100)) return false;
  if (typeof entry.finalStage !== "number") return false;
  if (typeof entry.hintsUsed !== "number") return false;
  if (typeof entry.skipped !== "boolean") return false;
  if (!isValidTimestamp(entry.solvedAt)) return false;
  if (!isValidOptionalString(entry.skipReason, MAX_ENUM_LIKE)) return false;
  if (!isValidOptionalString(entry.clueType, MAX_ENUM_LIKE)) return false;
  if (!isValidOptionalString(entry.concreteness, MAX_ENUM_LIKE)) return false;
  if (!isValidOptionalString(entry.revealedMeaning, MAX_FREE_TEXT)) return false;
  if (!isValidOptionalString(entry.priorKnowledge, MAX_ENUM_LIKE)) return false;
  if (!isValidOptionalString(entry.gotItVia, MAX_ENUM_LIKE)) return false;
  if (!isValidOptionalString(entry.clueIdentified, MAX_CLUE_PHRASE)) return false;
  if (!isValidOptionalBoolean(entry.transferPassed)) return false;
  if (!isValidOptionalNumber(entry.timeToAnswerSec)) return false;
  if (!isValidOptionalNumber(entry.minGateSec)) return false;
  if (!isValidOptionalString(entry.passageTitle, 200)) return false;
  if (!isValidOptionalString(entry.funFact, MAX_FREE_TEXT)) return false;
  return true;
}

async function handleSave(req, res, claims) {
  if (claims.kind !== "student") {
    return res.status(403).json({ error: "Only a student session can save progress" });
  }
  if (!isPlainObjectWithOnlyKeys(req.body, SAVE_ALLOWED_KEYS)) {
    return res.status(400).json({ error: "Missing or unexpected fields in request body" });
  }
  const { passageTitle, passageEmoji, startedAt, finishedAt, comprehensionResult, log } = req.body;
  if (!isValidShortString(passageTitle, 200)) return res.status(400).json({ error: "Invalid passage title" });
  if (passageEmoji !== undefined && passageEmoji !== null && !isValidShortString(passageEmoji, 20)) {
    return res.status(400).json({ error: "Invalid passage emoji" });
  }
  if (!isValidTimestamp(startedAt) || !isValidTimestamp(finishedAt)) {
    return res.status(400).json({ error: "Invalid session timestamps" });
  }
  if (!validateComprehensionResult(comprehensionResult)) {
    return res.status(400).json({ error: "Invalid comprehension result" });
  }
  if (!Array.isArray(log) || log.length === 0 || log.length > MAX_WORDS_PER_SESSION || !log.every(validateLogEntry)) {
    return res.status(400).json({ error: "Invalid session log" });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: "Server is missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      student_id: claims.studentId,
      passage_title: passageTitle,
      passage_emoji: passageEmoji || null,
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date(finishedAt).toISOString(),
      comprehension_result: comprehensionResult || null,
    })
    .select("id")
    .single();
  if (sessionError || !session) {
    return res.status(502).json({ error: "Couldn't save the session, please try again" });
  }

  const wordRows = log.map((entry) => ({
    session_id: session.id,
    word: entry.word,
    clue_type: entry.clueType || null,
    concreteness: entry.concreteness || null,
    final_stage: entry.finalStage,
    hints_used: entry.hintsUsed,
    skipped: entry.skipped,
    skip_reason: entry.skipReason || null,
    revealed_meaning: entry.revealedMeaning || null,
    prior_knowledge: entry.priorKnowledge || null,
    got_it_via: entry.gotItVia || null,
    clue_identified: entry.clueIdentified || null,
    transfer_passed: entry.transferPassed === undefined ? null : entry.transferPassed,
    time_to_answer_sec: entry.timeToAnswerSec === undefined ? null : entry.timeToAnswerSec,
    min_gate_sec: entry.minGateSec === undefined ? null : entry.minGateSec,
    fun_fact: entry.funFact || null,
    solved_at: new Date(entry.solvedAt).toISOString(),
  }));
  const { error: wordsError } = await supabase.from("session_words").insert(wordRows);
  if (wordsError) {
    // The insert isn't wrapped in a real transaction (two separate calls),
    // so a failure here would otherwise leave an orphaned "sessions" row
    // with no words attached. Best-effort compensating delete so a
    // client-side retry doesn't just pile up more orphans — if the delete
    // itself fails there's nothing more to do client-side, so it's
    // deliberately fire-and-forget beyond logging, and the original error
    // is what's reported either way.
    const { error: cleanupError } = await supabase.from("sessions").delete().eq("id", session.id);
    if (cleanupError) {
      console.error("Failed to clean up orphaned session row", session.id, cleanupError);
    }
    return res.status(502).json({ error: "Session saved but its word log failed, please tell your teacher" });
  }

  return res.status(200).json({ ok: true, sessionId: session.id });
}

async function handleFetch(req, res, claims) {
  if (claims.kind === "student") {
    return res.status(403).json({ error: "Teacher access required" });
  }
  const sessionId = typeof req.query?.sessionId === "string" ? req.query.sessionId : null;
  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId" });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: "Server is missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, passage_title, passage_emoji, started_at, finished_at, comprehension_result, diagnostic_report, teacher_notes, students!inner(id, full_name, access_code_label)")
    .eq("id", sessionId)
    .single();
  if (sessionError || !session || session.students.access_code_label !== claims.label) {
    return res.status(404).json({ error: "Session not found" });
  }

  const { data: words, error: wordsError } = await supabase
    .from("session_words")
    .select("word, clue_type, concreteness, final_stage, hints_used, skipped, skip_reason, revealed_meaning, prior_knowledge, got_it_via, clue_identified, transfer_passed, time_to_answer_sec, min_gate_sec, fun_fact, solved_at")
    .eq("session_id", sessionId)
    .order("solved_at", { ascending: true });
  if (wordsError) {
    return res.status(502).json({ error: "Couldn't load this session's word log" });
  }

  return res.status(200).json({
    session: {
      id: session.id,
      studentId: session.students.id,
      studentName: session.students.full_name,
      passageTitle: session.passage_title,
      passageEmoji: session.passage_emoji,
      startedAt: session.started_at,
      finishedAt: session.finished_at,
      comprehensionResult: session.comprehension_result,
      diagnosticReport: session.diagnostic_report,
      teacherNotes: session.teacher_notes,
    },
    log: words.map((w) => ({
      word: w.word,
      clueType: w.clue_type,
      concreteness: w.concreteness,
      finalStage: w.final_stage,
      hintsUsed: w.hints_used,
      skipped: w.skipped,
      skipReason: w.skip_reason,
      revealedMeaning: w.revealed_meaning,
      priorKnowledge: w.prior_knowledge,
      gotItVia: w.got_it_via,
      clueIdentified: w.clue_identified,
      transferPassed: w.transfer_passed,
      timeToAnswerSec: w.time_to_answer_sec,
      minGateSec: w.min_gate_sec,
      funFact: w.fun_fact,
      solvedAt: new Date(w.solved_at).getTime(),
    })),
  });
}

async function handlePatch(req, res, claims) {
  if (claims.kind === "student") {
    return res.status(403).json({ error: "Teacher access required" });
  }
  if (!isPlainObjectWithOnlyKeys(req.body, PATCH_ALLOWED_KEYS)) {
    return res.status(400).json({ error: "Missing or unexpected fields in request body" });
  }
  const { sessionId, diagnosticReport, teacherNotes } = req.body;
  if (typeof sessionId !== "string" || !sessionId) {
    return res.status(400).json({ error: "Missing sessionId" });
  }
  const hasDiagnosticReport = diagnosticReport !== undefined;
  const hasTeacherNotes = teacherNotes !== undefined;
  if (!hasDiagnosticReport && !hasTeacherNotes) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (hasDiagnosticReport && (!diagnosticReport || typeof diagnosticReport !== "object" || Array.isArray(diagnosticReport))) {
    return res.status(400).json({ error: "Invalid diagnostic report" });
  }
  // Teacher's own follow-up note (e.g. "tried the suggested activity,
  // it helped") -- same free-text ceiling as the AI's own short-text
  // fields (funFact/revealedMeaning) elsewhere in this file.
  if (hasTeacherNotes && teacherNotes !== null && !isValidShortString(teacherNotes, MAX_FREE_TEXT)) {
    return res.status(400).json({ error: "Invalid teacher notes" });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: "Server is missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, students!inner(access_code_label)")
    .eq("id", sessionId)
    .single();
  if (sessionError || !session || session.students.access_code_label !== claims.label) {
    return res.status(404).json({ error: "Session not found" });
  }

  const update = {};
  if (hasDiagnosticReport) update.diagnostic_report = diagnosticReport;
  if (hasTeacherNotes) update.teacher_notes = teacherNotes;
  const { error: updateError } = await supabase.from("sessions").update(update).eq("id", sessionId);
  if (updateError) {
    return res.status(502).json({ error: "Couldn't save that, please try again" });
  }
  return res.status(200).json({ ok: true });
}

// A teacher permanently deleting one session (e.g. cleaning up test data),
// distinct from a student's own session history staying intact otherwise.
// session_words rows are removed automatically by the FK's ON DELETE
// CASCADE (see supabase/schema.sql), so this is a single delete here.
async function handleDelete(req, res, claims) {
  if (claims.kind === "student") {
    return res.status(403).json({ error: "Teacher access required" });
  }
  const sessionId = typeof req.query?.sessionId === "string" ? req.query.sessionId : null;
  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId" });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: "Server is missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, students!inner(access_code_label)")
    .eq("id", sessionId)
    .single();
  if (sessionError || !session || session.students.access_code_label !== claims.label) {
    return res.status(404).json({ error: "Session not found" });
  }

  const { error: deleteError } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (deleteError) {
    return res.status(502).json({ error: "Couldn't delete the session, please try again" });
  }
  return res.status(200).json({ ok: true });
}

export default async function sessionHandler(req, res) {
  if (!["POST", "GET", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "POST, GET, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isOriginAllowed(req)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const ip = getClientIp(req);
  if (checkRateLimit(ip).limited) {
    return res.status(429).json({ error: "Too many requests, please slow down" });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Server is missing AUTH_SECRET" });
  }

  const token = getBearerToken(req);
  const claims = verifyToken(token, secret);
  if (!claims) {
    // See the matching comment in _studentAuthHandler.js — tokenInvalid is
    // what the client's re-auth-overlay logic actually keys off of.
    return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });
  }

  if (req.method === "POST") return handleSave(req, res, claims);
  if (req.method === "GET") return handleFetch(req, res, claims);
  if (req.method === "DELETE") return handleDelete(req, res, claims);
  return handlePatch(req, res, claims);
}
