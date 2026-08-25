// Shared handler backing the teacher's "File Box": the roster of
// students enrolled under this access code (optionally scoped to one
// class), that roster's stats rollup, a specific student's list of past
// sessions, and class management (create/rename/delete a class, assign/
// unassign a student to one). Used by both api/teacher-roster.js
// (Vercel) and server.js.
//
// GET    /api/teacher-roster                          -> this teacher's
//   full student roster + stats rollup + this teacher's classes
// GET    /api/teacher-roster?classId=<id>              -> same, scoped to
//   just that class's students (roster + rollup both filtered)
// GET    /api/teacher-roster?classId=none              -> same, scoped to
//   students not currently assigned to any class
// GET    /api/teacher-roster?studentId=<id>            -> that student's
//   session summaries
// POST   /api/teacher-roster  {name}                   -> create a class
// PATCH  /api/teacher-roster  {kind:"renameClass", classId, name}
// PATCH  /api/teacher-roster  {kind:"assignStudent", studentId, classId}
//   classId is a class's id string, or null to unassign
// DELETE /api/teacher-roster?studentId=<id>  -> permanently delete that
//   student and every one of their sessions (ON DELETE CASCADE)
// DELETE /api/teacher-roster?classId=<id>    -> permanently delete that
//   class; its students are NOT deleted, just unassigned (class_id set
//   to null via ON DELETE SET NULL, see schema.sql)
//
// studentId/classId are always checked against this teacher token's
// access_code_label before use, so a guessed/leaked id from another
// school's roster returns nothing (GET), changes nothing (PATCH), and
// deletes nothing (DELETE).

import { verifyToken } from "./_auth.js";
import { isOriginAllowed, getClientIp, createRateLimiter, getBearerToken, isPlainObjectWithOnlyKeys } from "./_shared.js";
import { getSupabase } from "./_supabase.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const checkRateLimit = createRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);

const CLASS_NAME_MAX_LENGTH = 60;

// Same breakdown computeAtAGlance does client-side for one session's log
// (src/App.jsx), applied here to a pooled set of session_words rows
// spanning many sessions/students -- one student's whole history (the
// "cross-session pattern" and "vs their own average" callouts in
// TeacherScreen), a whole class's, or (with no class filter) the whole
// access code's roster. Deliberately counts only, no AI: the same "blue
// box" trust boundary as the rest of the deterministic parts of a report.
const CLUE_TYPES = ["contrast", "definition", "example", "inference"];

function computeStatsBreakdown(words) {
  const solved = words.filter((w) => !w.skipped);
  const independent = solved.filter((w) => w.hints_used === 0).length;
  const withHelp = solved.filter((w) => w.hints_used > 0).length;
  const skipped = words.filter((w) => w.skipped).length;
  const breakdown = CLUE_TYPES
    .map((type) => {
      const inType = words.filter((w) => w.clue_type === type && !w.skipped);
      return { type, total: inType.length, independent: inType.filter((w) => w.hints_used === 0).length };
    })
    .filter((b) => b.total > 0);
  return { total: words.length, independent, withHelp, skipped, breakdown };
}

function normalizeClassName(name) {
  return typeof name === "string" ? name.trim() : "";
}

async function fetchClasses(supabase, label) {
  return supabase
    .from("classes")
    .select("id, name")
    .eq("access_code_label", label)
    .order("name", { ascending: true });
}

async function fetchRoster(supabase, label, res, classId) {
  let query = supabase
    .from("students")
    .select("id, full_name, created_at, last_login_at, class_id, sessions(id, finished_at, session_words(clue_type, hints_used, skipped))")
    .eq("access_code_label", label)
    .order("full_name", { ascending: true });
  if (classId === "none") {
    query = query.is("class_id", null);
  } else if (classId) {
    query = query.eq("class_id", classId);
  }

  const [{ data: students, error }, { data: classes, error: classesError }] = await Promise.all([
    query,
    fetchClasses(supabase, label),
  ]);
  if (error || classesError) {
    return res.status(502).json({ error: "Couldn't load the roster, please try again" });
  }
  let contributingStudents = 0;
  const allWords = [];
  const roster = students.map((s) => {
    const finishedSessions = (s.sessions || []).filter((sess) => sess.finished_at);
    if (finishedSessions.length > 0) {
      contributingStudents += 1;
      for (const sess of finishedSessions) allWords.push(...(sess.session_words || []));
    }
    const lastSessionAt = finishedSessions.reduce(
      (latest, sess) => (!latest || sess.finished_at > latest ? sess.finished_at : latest),
      null
    );
    return {
      id: s.id,
      fullName: s.full_name,
      createdAt: s.created_at,
      lastLoginAt: s.last_login_at,
      classId: s.class_id,
      sessionCount: finishedSessions.length,
      lastSessionAt,
    };
  });
  const classStats = { ...computeStatsBreakdown(allWords), studentCount: contributingStudents };
  return res.status(200).json({ students: roster, classStats, classes: classes || [] });
}

async function fetchStudentSessions(supabase, label, studentId, res) {
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, full_name, access_code_label")
    .eq("id", studentId)
    .single();
  if (studentError || !student || student.access_code_label !== label) {
    return res.status(404).json({ error: "Student not found" });
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("id, passage_title, passage_emoji, started_at, finished_at, comprehension_result, session_words(id, clue_type, hints_used, skipped)")
    .eq("student_id", studentId)
    .order("started_at", { ascending: false });
  if (sessionsError) {
    return res.status(502).json({ error: "Couldn't load this student's sessions" });
  }

  const finishedSessions = sessions.filter((s) => s.finished_at);
  const studentStats = {
    ...computeStatsBreakdown(finishedSessions.flatMap((s) => s.session_words || [])),
    sessionCount: finishedSessions.length,
  };

  return res.status(200).json({
    student: { id: student.id, fullName: student.full_name },
    sessions: finishedSessions.map((s) => ({
      id: s.id,
      passageTitle: s.passage_title,
      passageEmoji: s.passage_emoji,
      startedAt: s.started_at,
      finishedAt: s.finished_at,
      wordCount: (s.session_words || []).length,
      comprehensionCorrect: s.comprehension_result?.correct ?? null,
    })),
    studentStats,
  });
}

// A teacher permanently deleting one whole student account — every session
// and every session's word log go with it via ON DELETE CASCADE (see
// supabase/schema.sql), so this is a single delete here, same pattern as
// handleDelete in _sessionHandler.js for a single session.
async function deleteStudent(supabase, label, studentId, res) {
  const { data: student, error: lookupError } = await supabase
    .from("students")
    .select("id, access_code_label")
    .eq("id", studentId)
    .maybeSingle();
  if (lookupError) {
    return res.status(502).json({ error: "Couldn't reach the database, please try again" });
  }
  if (!student || student.access_code_label !== label) {
    return res.status(404).json({ error: "Student not found" });
  }

  const { error: deleteError } = await supabase.from("students").delete().eq("id", studentId);
  if (deleteError) {
    return res.status(502).json({ error: "Couldn't delete this student, please try again" });
  }
  return res.status(200).json({ ok: true });
}

// Deleting a class never deletes its students -- ON DELETE SET NULL on
// students.class_id (see schema.sql) unassigns them back to the
// "Unassigned" bucket instead, since a class is just a grouping, not
// ownership of the student accounts themselves.
async function deleteClass(supabase, label, classId, res) {
  const { data: cls, error: lookupError } = await supabase
    .from("classes")
    .select("id, access_code_label")
    .eq("id", classId)
    .maybeSingle();
  if (lookupError) {
    return res.status(502).json({ error: "Couldn't reach the database, please try again" });
  }
  if (!cls || cls.access_code_label !== label) {
    return res.status(404).json({ error: "Class not found" });
  }

  const { error: deleteError } = await supabase.from("classes").delete().eq("id", classId);
  if (deleteError) {
    return res.status(502).json({ error: "Couldn't delete this class, please try again" });
  }
  return res.status(200).json({ ok: true });
}

async function createClass(supabase, label, name, res) {
  const cleanName = normalizeClassName(name);
  if (!cleanName || cleanName.length > CLASS_NAME_MAX_LENGTH) {
    return res.status(400).json({ error: `Class name must be 1-${CLASS_NAME_MAX_LENGTH} characters` });
  }
  const { data: created, error } = await supabase
    .from("classes")
    .insert({ access_code_label: label, name: cleanName })
    .select("id, name")
    .single();
  if (error) {
    return res.status(502).json({ error: "Couldn't create the class, please try again" });
  }
  return res.status(200).json({ class: created });
}

async function renameClass(supabase, label, classId, name, res) {
  const cleanName = normalizeClassName(name);
  if (typeof classId !== "string" || !classId) {
    return res.status(400).json({ error: "Missing classId" });
  }
  if (!cleanName || cleanName.length > CLASS_NAME_MAX_LENGTH) {
    return res.status(400).json({ error: `Class name must be 1-${CLASS_NAME_MAX_LENGTH} characters` });
  }
  const { data: cls, error: lookupError } = await supabase
    .from("classes")
    .select("id, access_code_label")
    .eq("id", classId)
    .maybeSingle();
  if (lookupError) {
    return res.status(502).json({ error: "Couldn't reach the database, please try again" });
  }
  if (!cls || cls.access_code_label !== label) {
    return res.status(404).json({ error: "Class not found" });
  }
  const { error: updateError } = await supabase.from("classes").update({ name: cleanName }).eq("id", classId);
  if (updateError) {
    return res.status(502).json({ error: "Couldn't rename the class, please try again" });
  }
  return res.status(200).json({ ok: true });
}

async function assignStudent(supabase, label, studentId, classId, res) {
  if (typeof studentId !== "string" || !studentId) {
    return res.status(400).json({ error: "Missing studentId" });
  }
  if (classId !== null && typeof classId !== "string") {
    return res.status(400).json({ error: "classId must be a string or null" });
  }
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, access_code_label")
    .eq("id", studentId)
    .maybeSingle();
  if (studentError) {
    return res.status(502).json({ error: "Couldn't reach the database, please try again" });
  }
  if (!student || student.access_code_label !== label) {
    return res.status(404).json({ error: "Student not found" });
  }
  if (classId !== null) {
    const { data: cls, error: classError } = await supabase
      .from("classes")
      .select("id, access_code_label")
      .eq("id", classId)
      .maybeSingle();
    if (classError) {
      return res.status(502).json({ error: "Couldn't reach the database, please try again" });
    }
    if (!cls || cls.access_code_label !== label) {
      return res.status(404).json({ error: "Class not found" });
    }
  }
  const { error: updateError } = await supabase.from("students").update({ class_id: classId }).eq("id", studentId);
  if (updateError) {
    return res.status(502).json({ error: "Couldn't update this student's class, please try again" });
  }
  return res.status(200).json({ ok: true });
}

const ALLOWED_POST_KEYS = ["name"];
const ALLOWED_PATCH_KEYS = ["kind", "classId", "name", "studentId"];

export default async function teacherRosterHandler(req, res) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
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
  if (!claims || claims.kind === "student") {
    // See the matching comment in _studentAuthHandler.js — tokenInvalid is
    // what the client's re-auth-overlay logic actually keys off of.
    return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: "Server is missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY" });
  }

  const studentId = typeof req.query?.studentId === "string" ? req.query.studentId : null;
  const classIdParam = typeof req.query?.classId === "string" ? req.query.classId : null;

  if (req.method === "POST") {
    if (!isPlainObjectWithOnlyKeys(req.body, ALLOWED_POST_KEYS)) {
      return res.status(400).json({ error: "Missing or unexpected fields in request body" });
    }
    return createClass(supabase, claims.label, req.body?.name, res);
  }

  if (req.method === "PATCH") {
    if (!isPlainObjectWithOnlyKeys(req.body, ALLOWED_PATCH_KEYS)) {
      return res.status(400).json({ error: "Missing or unexpected fields in request body" });
    }
    if (req.body?.kind === "renameClass") {
      return renameClass(supabase, claims.label, req.body?.classId, req.body?.name, res);
    }
    if (req.body?.kind === "assignStudent") {
      const classId = req.body?.classId === undefined ? null : req.body.classId;
      return assignStudent(supabase, claims.label, req.body?.studentId, classId, res);
    }
    return res.status(400).json({ error: "Invalid kind" });
  }

  if (req.method === "DELETE") {
    if (studentId && classIdParam) {
      return res.status(400).json({ error: "Pass only one of studentId or classId" });
    }
    if (classIdParam) {
      return deleteClass(supabase, claims.label, classIdParam, res);
    }
    if (!studentId) {
      return res.status(400).json({ error: "Missing studentId" });
    }
    return deleteStudent(supabase, claims.label, studentId, res);
  }

  if (studentId) {
    return fetchStudentSessions(supabase, claims.label, studentId, res);
  }
  return fetchRoster(supabase, claims.label, res, classIdParam);
}
