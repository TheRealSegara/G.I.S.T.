// Local-only demo backend for rehearsal/insurance purposes — NOT used by
// the deployed app in any way (Vercel uses api/*.js directly; server.js is
// the separate real Cloud-Run-style backend). This file exists so the
// exact real production frontend (npm run build's dist/ output, byte for
// byte what's deployed) can be played through completely offline: no
// Groq key, no Supabase project, no daily quota, no network dependency at
// all. Every response shape below matches the real handlers in api/*.js
// exactly, so the frontend needs zero code changes to talk to this instead.
//
// Word content and coaching logic live in scripts/mock-backend-logic.mjs,
// shared with scripts/build-offline-demo.mjs (the single-file browser
// build) so the two never drift apart.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signToken, verifyToken } from "../api/_auth.js";
import { mockClaude } from "./mock-backend-logic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

// Local-only secret — never read from a real env var, never touches the
// real deployed AUTH_SECRET, so there's zero chance of cross-contamination.
const SECRET = "local-demo-only-not-a-real-secret";
const TOKEN_TTL_MINUTES = 720;

/* ---------------- in-memory "database" ---------------- */
let nextStudentId = 1;
let nextSessionId = 1;
let nextClassId = 1;
const students = []; // { id, fullName, fullNameKey, secret, avatarConfig, label, classId }
const sessions = []; // { id, studentId, passageTitle, passageEmoji, startedAt, finishedAt, comprehensionResult, diagnosticReport, log }
const classes = []; // { id, name, label }
let quotaUsedToday = 0;

const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/auth", (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!code) return res.status(400).json({ error: "Missing access code" });
  const exp = Date.now() + TOKEN_TTL_MINUTES * 60_000;
  const token = signToken({ kind: "teacher", label: code.toUpperCase(), exp }, SECRET);
  return res.status(200).json({ token, expiresAt: exp, dailyLimit: 999999 });
});

app.post("/api/claude", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(token, SECRET);
  if (!claims) return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });
  quotaUsedToday += 1;
  const reply = mockClaude(req.body.promptId || "", req.body.messages || []);
  return res.status(200).json({
    content: [{ type: "text", text: JSON.stringify(reply) }],
    quota: { used: quotaUsedToday, limit: 999999, remaining: 999999 - quotaUsedToday, exceeded: false },
  });
});

app.post("/api/student-auth", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const teacherToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(teacherToken, SECRET);
  if (!claims) return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });

  const { mode, fullName, secret, avatarConfig, studentId } = req.body || {};
  const nameKey = (fullName || "").trim().toLowerCase();

  if (mode === "signup") {
    if (students.some((s) => s.label === claims.label && s.fullNameKey === nameKey)) {
      return res.status(409).json({ error: "That name is already registered. Try Returning Student instead." });
    }
    const student = { id: String(nextStudentId++), fullName: fullName.trim(), fullNameKey: nameKey, secret, avatarConfig, label: claims.label, createdAt: new Date().toISOString(), lastLoginAt: null, classId: null };
    students.push(student);
    const exp = Date.now() + TOKEN_TTL_MINUTES * 60_000;
    const stToken = signToken({ kind: "student", studentId: student.id, label: claims.label, exp }, SECRET);
    return res.status(200).json({ token: stToken, expiresAt: exp, student: { id: student.id, fullName: student.fullName, avatarConfig: student.avatarConfig } });
  }

  if (mode === "login") {
    const student = students.find((s) => s.label === claims.label && s.fullNameKey === nameKey);
    if (!student || JSON.stringify(student.secret) !== JSON.stringify(secret)) {
      return res.status(401).json({ error: "Name or secret animals not recognized. Ask your teacher, or sign up as a new student." });
    }
    student.lastLoginAt = new Date().toISOString();
    const exp = Date.now() + TOKEN_TTL_MINUTES * 60_000;
    const stToken = signToken({ kind: "student", studentId: student.id, label: claims.label, exp }, SECRET);
    return res.status(200).json({ token: stToken, expiresAt: exp, student: { id: student.id, fullName: student.fullName, avatarConfig: student.avatarConfig } });
  }

  if (mode === "reset") {
    const student = students.find((s) => s.id === studentId && s.label === claims.label);
    if (!student) return res.status(404).json({ error: "Student not found" });
    student.secret = secret;
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Invalid mode" });
});

app.post("/api/session", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(token, SECRET);
  if (!claims || claims.kind !== "student") return res.status(403).json({ error: "Only a student session can save progress" });
  const { passageTitle, passageEmoji, startedAt, finishedAt, comprehensionResult, log } = req.body || {};
  const session = { id: String(nextSessionId++), studentId: claims.studentId, passageTitle, passageEmoji, startedAt, finishedAt, comprehensionResult, diagnosticReport: null, log, teacherNotes: null };
  sessions.push(session);
  return res.status(200).json({ ok: true, sessionId: session.id });
});

app.get("/api/session", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(token, SECRET);
  if (!claims || claims.kind === "student") return res.status(403).json({ error: "Teacher access required" });
  const session = sessions.find((s) => s.id === req.query.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const student = students.find((s) => s.id === session.studentId);
  return res.status(200).json({
    session: { id: session.id, studentId: session.studentId, studentName: student?.fullName || "Student", passageTitle: session.passageTitle, passageEmoji: session.passageEmoji, startedAt: session.startedAt, finishedAt: session.finishedAt, comprehensionResult: session.comprehensionResult, diagnosticReport: session.diagnosticReport, teacherNotes: session.teacherNotes },
    log: session.log || [],
  });
});

app.patch("/api/session", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(token, SECRET);
  if (!claims || claims.kind === "student") return res.status(403).json({ error: "Teacher access required" });
  const session = sessions.find((s) => s.id === req.body.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.diagnosticReport = req.body.diagnosticReport;
  return res.status(200).json({ ok: true });
});

app.delete("/api/session", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(token, SECRET);
  if (!claims || claims.kind === "student") return res.status(403).json({ error: "Teacher access required" });
  const idx = sessions.findIndex((s) => s.id === req.query.sessionId);
  if (idx === -1) return res.status(404).json({ error: "Session not found" });
  sessions.splice(idx, 1);
  return res.status(200).json({ ok: true });
});

// Mirrors computeStatsBreakdown in api/_teacherRosterHandler.js (camelCase
// log-entry shape here instead of that file's snake_case DB columns) so
// the offline/rehearsal demo shows the same class-rollup and cross-session
// callouts as the real deployed app, not a silently stripped-down version.
const CLUE_TYPES = ["contrast", "definition", "example", "inference"];
function computeStatsBreakdown(words) {
  const solved = words.filter((w) => !w.skipped);
  const independent = solved.filter((w) => w.hintsUsed === 0).length;
  const withHelp = solved.filter((w) => w.hintsUsed > 0).length;
  const skipped = words.filter((w) => w.skipped).length;
  const breakdown = CLUE_TYPES
    .map((type) => {
      const inType = words.filter((w) => w.clueType === type && !w.skipped);
      return { type, total: inType.length, independent: inType.filter((w) => w.hintsUsed === 0).length };
    })
    .filter((b) => b.total > 0);
  return { total: words.length, independent, withHelp, skipped, breakdown };
}

app.get("/api/teacher-roster", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(token, SECRET);
  if (!claims || claims.kind === "student") return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });

  const studentId = req.query.studentId;
  if (studentId) {
    const student = students.find((s) => s.id === studentId && s.label === claims.label);
    if (!student) return res.status(404).json({ error: "Student not found" });
    const studentSessions = sessions.filter((s) => s.studentId === studentId);
    const studentStats = { ...computeStatsBreakdown(studentSessions.flatMap((s) => s.log || [])), sessionCount: studentSessions.length };
    return res.status(200).json({
      student: { id: student.id, fullName: student.fullName },
      sessions: studentSessions.map((s) => ({ id: s.id, passageTitle: s.passageTitle, passageEmoji: s.passageEmoji, startedAt: s.startedAt, finishedAt: s.finishedAt, wordCount: (s.log || []).length, comprehensionCorrect: s.comprehensionResult?.correct ?? null })),
      studentStats,
    });
  }

  let contributingStudents = 0;
  const allWords = [];
  const classIdFilter = req.query.classId;
  let scopedStudents = students.filter((s) => s.label === claims.label);
  if (classIdFilter === "none") {
    scopedStudents = scopedStudents.filter((s) => !s.classId);
  } else if (classIdFilter) {
    scopedStudents = scopedStudents.filter((s) => s.classId === classIdFilter);
  }
  const roster = scopedStudents.map((s) => {
    const studentSessions = sessions.filter((sess) => sess.studentId === s.id);
    if (studentSessions.length > 0) {
      contributingStudents += 1;
      for (const sess of studentSessions) allWords.push(...(sess.log || []));
    }
    const lastSessionAt = studentSessions.reduce((latest, sess) => (!latest || sess.finishedAt > latest ? sess.finishedAt : latest), null);
    return { id: s.id, fullName: s.fullName, createdAt: s.createdAt, lastLoginAt: s.lastLoginAt, classId: s.classId, sessionCount: studentSessions.length, lastSessionAt };
  });
  const classStats = { ...computeStatsBreakdown(allWords), studentCount: contributingStudents };
  const teacherClasses = classes.filter((c) => c.label === claims.label).map((c) => ({ id: c.id, name: c.name }));
  return res.status(200).json({ students: roster, classStats, classes: teacherClasses });
});

app.post("/api/teacher-roster", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(token, SECRET);
  if (!claims || claims.kind === "student") return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 60) return res.status(400).json({ error: "Class name must be 1-60 characters" });
  const cls = { id: String(nextClassId++), name, label: claims.label };
  classes.push(cls);
  return res.status(200).json({ class: { id: cls.id, name: cls.name } });
});

app.patch("/api/teacher-roster", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(token, SECRET);
  if (!claims || claims.kind === "student") return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });

  if (req.body?.kind === "renameClass") {
    const cls = classes.find((c) => c.id === req.body.classId && c.label === claims.label);
    if (!cls) return res.status(404).json({ error: "Class not found" });
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 60) return res.status(400).json({ error: "Class name must be 1-60 characters" });
    cls.name = name;
    return res.status(200).json({ ok: true });
  }

  if (req.body?.kind === "assignStudent") {
    const student = students.find((s) => s.id === req.body.studentId && s.label === claims.label);
    if (!student) return res.status(404).json({ error: "Student not found" });
    const classId = req.body?.classId ?? null;
    if (classId !== null) {
      const cls = classes.find((c) => c.id === classId && c.label === claims.label);
      if (!cls) return res.status(404).json({ error: "Class not found" });
    }
    student.classId = classId;
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Invalid kind" });
});

app.delete("/api/teacher-roster", (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const claims = verifyToken(token, SECRET);
  if (!claims || claims.kind === "student") return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });

  if (req.query.classId) {
    const idx = classes.findIndex((c) => c.id === req.query.classId && c.label === claims.label);
    if (idx === -1) return res.status(404).json({ error: "Class not found" });
    classes.splice(idx, 1);
    // ON DELETE SET NULL equivalent: unassign, don't delete, the students.
    for (const s of students) if (s.classId === req.query.classId) s.classId = null;
    return res.status(200).json({ ok: true });
  }

  const idx = students.findIndex((s) => s.id === req.query.studentId && s.label === claims.label);
  if (idx === -1) return res.status(404).json({ error: "Student not found" });
  students.splice(idx, 1);
  for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].studentId === req.query.studentId) sessions.splice(i, 1);
  return res.status(200).json({ ok: true });
});

app.use(express.static(distDir));
app.get("*", (req, res) => res.sendFile(path.join(distDir, "index.html")));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`G.I.S.T. local demo server (no Groq, no Supabase, no quota) running at http://localhost:${port}`);
  console.log(`Enter ANY access code on the gate screen — it always works.`);
});
