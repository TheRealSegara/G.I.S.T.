// Builds a SINGLE self-contained HTML file: the real production frontend
// (dist/assets/*.js + *.css, byte-for-byte what `npm run build` produces)
// inlined alongside a browser-side mock backend that patches window.fetch
// before the app boots. No Node, no npm install, no terminal, no server --
// just double-click the output file and open it in a browser.
//
// The word content and coaching logic itself lives in
// scripts/mock-backend-logic.mjs, shared with scripts/local-demo-server.mjs
// (the Node/Express version) -- read in here as plain text and inlined
// (its trailing `export {...}` statement stripped, since this runs as a
// classic browser <script>, not an ES module) so the two never drift apart.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distDir = path.join(root, "dist");
const assetsDir = path.join(distDir, "assets");

const jsFile = fs.readdirSync(assetsDir).find((f) => f.endsWith(".js"));
const cssFile = fs.readdirSync(assetsDir).find((f) => f.endsWith(".css"));
if (!jsFile || !cssFile) {
  console.error("Couldn't find built assets in dist/assets -- run `npm run build` first.");
  process.exit(1);
}
const appJs = fs.readFileSync(path.join(assetsDir, jsFile), "utf8");
const appCss = fs.readFileSync(path.join(assetsDir, cssFile), "utf8");

const mockLogicSource = fs.readFileSync(path.join(__dirname, "mock-backend-logic.mjs"), "utf8");
// Strip the leading `export ` keywords are never used inline in that file
// (only the trailing `export { ... };` block), so just cut everything from
// that block onward.
const exportIdx = mockLogicSource.indexOf("\nexport {");
if (exportIdx === -1) {
  console.error("Couldn't find the trailing export block in mock-backend-logic.mjs -- did its structure change?");
  process.exit(1);
}
const mockLogicBody = mockLogicSource.slice(0, exportIdx);

// ---------------------------------------------------------------------
// Mock bootstrap script, as a plain string (this runs in the browser, not
// in this Node build script): the shared mock logic (word content,
// mockClaude()) plus a fetch()-interception harness that plays the role
// Express route handlers play in scripts/local-demo-server.mjs.
// ---------------------------------------------------------------------
const mockScript = String.raw`
(function () {
  var TOKEN_TTL_MINUTES = 720;

  function makeToken(payload) {
    var full = Object.assign({}, payload, { exp: Date.now() + TOKEN_TTL_MINUTES * 60000 });
    return btoa(unescape(encodeURIComponent(JSON.stringify(full))));
  }
  function readToken(token) {
    if (typeof token !== "string") return null;
    try {
      var payload = JSON.parse(decodeURIComponent(escape(atob(token))));
      if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
      return payload;
    } catch (e) { return null; }
  }

` + mockLogicBody + `

  /* ---------------- in-memory "database" (resets on page reload) ---------------- */
  var nextStudentId = 1, nextSessionId = 1, nextClassId = 1;
  var students = [];
  var sessions = [];
  var classes = [];
  var quotaUsedToday = 0;

  function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } });
  }
  // Mirrors computeStatsBreakdown in api/_teacherRosterHandler.js, so this
  // offline single-file demo shows the same class-rollup and cross-session
  // callouts as the real deployed app.
  var CLUE_TYPES = ["contrast", "definition", "example", "inference"];
  function computeStatsBreakdown(words) {
    var solved = words.filter(function (w) { return !w.skipped; });
    var independent = solved.filter(function (w) { return w.hintsUsed === 0; }).length;
    var withHelp = solved.filter(function (w) { return w.hintsUsed > 0; }).length;
    var skipped = words.filter(function (w) { return w.skipped; }).length;
    var breakdown = CLUE_TYPES.map(function (type) {
      var inType = words.filter(function (w) { return w.clueType === type && !w.skipped; });
      return { type: type, total: inType.length, independent: inType.filter(function (w) { return w.hintsUsed === 0; }).length };
    }).filter(function (b) { return b.total > 0; });
    return { total: words.length, independent: independent, withHelp: withHelp, skipped: skipped, breakdown: breakdown };
  }
  function weakestClueType(breakdown, minTotal) {
    minTotal = minTotal || 2;
    var eligible = (breakdown || []).filter(function (b) { return b.total >= minTotal; });
    if (eligible.length === 0) return null;
    return eligible.reduce(function (worst, b) { return b.independent / b.total < worst.independent / worst.total ? b : worst; });
  }
  function computeCalibration(words) {
    var withPriorKnowledge = words.filter(function (w) { return w.priorKnowledge; });
    var overconfidence = withPriorKnowledge.filter(function (w) { return w.priorKnowledge === "yes" && (w.skipped || w.hintsUsed > 0); }).length;
    var contradictions = withPriorKnowledge.filter(function (w) { return w.priorKnowledge === "no" && w.gotItVia === "knew"; }).length;
    return { overconfidence: overconfidence, contradictions: contradictions, sampleSize: withPriorKnowledge.length };
  }
  function buildWordHistory(studentSessions) {
    var history = {};
    studentSessions.forEach(function (sess) {
      (sess.log || []).forEach(function (w) {
        var key = String(w.word || "").trim().toLowerCase();
        if (!key) return;
        if (!history[key]) history[key] = [];
        history[key].push({ sessionId: sess.id, finalStage: w.finalStage, hintsUsed: w.hintsUsed, skipped: w.skipped, solvedAt: w.solvedAt });
      });
    });
    Object.keys(history).forEach(function (key) {
      history[key].sort(function (a, b) { return new Date(a.solvedAt) - new Date(b.solvedAt); });
    });
    return history;
  }
  function getClaims(headersInit) {
    var headers = new Headers(headersInit || {});
    var auth = headers.get("authorization") || headers.get("Authorization") || "";
    var token = auth.indexOf("Bearer ") === 0 ? auth.slice(7) : null;
    return readToken(token);
  }

  var realFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    var urlStr = typeof input === "string" ? input : (input && input.url) || "";
    var method = ((init && init.method) || (input && typeof input !== "string" && input.method) || "GET").toUpperCase();
    var u;
    try { u = new URL(urlStr, location.href); } catch (e) { return realFetch(input, init); }
    if (u.pathname.indexOf("/api/") !== 0) return realFetch(input, init);

    var headersInit = (init && init.headers) || (input && typeof input !== "string" && input.headers) || {};
    var bodyRaw = (init && init.body) || null;
    var body = {};
    try { body = bodyRaw ? JSON.parse(bodyRaw) : {}; } catch (e) {}

    return new Promise(function (resolve) {
      // Tiny artificial delay so loading states are visible, same as a real network call.
      setTimeout(function () {
        var pathname = u.pathname;

        if (pathname === "/api/auth" && method === "POST") {
          var code = typeof body.code === "string" ? body.code.trim() : "";
          if (!code) { resolve(jsonResponse(400, { error: "Missing access code" })); return; }
          var token = makeToken({ kind: "teacher", label: code.toUpperCase() });
          var claims0 = readToken(token);
          resolve(jsonResponse(200, { token: token, expiresAt: claims0.exp, dailyLimit: 999999 }));
          return;
        }

        if (pathname === "/api/claude" && method === "POST") {
          var claims1 = getClaims(headersInit);
          if (!claims1) { resolve(jsonResponse(401, { error: "Missing or expired access token", tokenInvalid: true })); return; }
          quotaUsedToday += 1;
          var reply = mockClaude(body.promptId || "", body.messages || [], body.params);
          resolve(jsonResponse(200, { content: [{ type: "text", text: JSON.stringify(reply) }], quota: { used: quotaUsedToday, limit: 999999, remaining: 999999 - quotaUsedToday, exceeded: false } }));
          return;
        }

        if (pathname === "/api/student-auth" && method === "POST") {
          var claims2 = getClaims(headersInit);
          if (!claims2) { resolve(jsonResponse(401, { error: "Missing or expired access token", tokenInvalid: true })); return; }
          var mode = body.mode, fullName = body.fullName, secret = body.secret, avatarConfig = body.avatarConfig, studentId = body.studentId;
          var nameKey = (fullName || "").trim().toLowerCase();
          if (mode === "signup") {
            var dup = students.some(function (s) { return s.label === claims2.label && s.fullNameKey === nameKey; });
            if (dup) { resolve(jsonResponse(409, { error: "That name is already registered. Try Returning Student instead." })); return; }
            var student = { id: String(nextStudentId++), fullName: fullName.trim(), fullNameKey: nameKey, secret: secret, avatarConfig: avatarConfig, label: claims2.label, createdAt: new Date().toISOString(), lastLoginAt: null, classId: null };
            students.push(student);
            var stToken = makeToken({ kind: "student", studentId: student.id, label: claims2.label });
            var stClaims = readToken(stToken);
            resolve(jsonResponse(200, { token: stToken, expiresAt: stClaims.exp, student: { id: student.id, fullName: student.fullName, avatarConfig: student.avatarConfig } }));
            return;
          }
          if (mode === "login") {
            var found2 = students.find(function (s) { return s.label === claims2.label && s.fullNameKey === nameKey; });
            if (!found2 || JSON.stringify(found2.secret) !== JSON.stringify(secret)) { resolve(jsonResponse(401, { error: "Name or secret animals not recognized. Ask your teacher, or sign up as a new student." })); return; }
            found2.lastLoginAt = new Date().toISOString();
            var stToken2 = makeToken({ kind: "student", studentId: found2.id, label: claims2.label });
            var stClaims2 = readToken(stToken2);
            resolve(jsonResponse(200, { token: stToken2, expiresAt: stClaims2.exp, student: { id: found2.id, fullName: found2.fullName, avatarConfig: found2.avatarConfig } }));
            return;
          }
          if (mode === "reset") {
            var found3 = students.find(function (s) { return s.id === studentId && s.label === claims2.label; });
            if (!found3) { resolve(jsonResponse(404, { error: "Student not found" })); return; }
            found3.secret = secret;
            resolve(jsonResponse(200, { ok: true }));
            return;
          }
          resolve(jsonResponse(400, { error: "Invalid mode" }));
          return;
        }

        if (pathname === "/api/session" && method === "POST") {
          var claims3 = getClaims(headersInit);
          if (!claims3 || claims3.kind !== "student") { resolve(jsonResponse(403, { error: "Only a student session can save progress" })); return; }
          var session = { id: String(nextSessionId++), studentId: claims3.studentId, passageTitle: body.passageTitle, passageEmoji: body.passageEmoji, startedAt: body.startedAt, finishedAt: body.finishedAt, comprehensionResult: body.comprehensionResult, diagnosticReport: null, log: body.log, teacherNotes: null };
          sessions.push(session);
          resolve(jsonResponse(200, { ok: true, sessionId: session.id }));
          return;
        }

        if (pathname === "/api/session" && method === "GET") {
          var claims4 = getClaims(headersInit);
          if (!claims4 || claims4.kind === "student") { resolve(jsonResponse(403, { error: "Teacher access required" })); return; }
          var sessionId = u.searchParams.get("sessionId");
          var session2 = sessions.find(function (s) { return s.id === sessionId; });
          if (!session2) { resolve(jsonResponse(404, { error: "Session not found" })); return; }
          var studentForSession = students.find(function (s) { return s.id === session2.studentId; });
          resolve(jsonResponse(200, {
            session: { id: session2.id, studentId: session2.studentId, studentName: (studentForSession && studentForSession.fullName) || "Student", passageTitle: session2.passageTitle, passageEmoji: session2.passageEmoji, startedAt: session2.startedAt, finishedAt: session2.finishedAt, comprehensionResult: session2.comprehensionResult, diagnosticReport: session2.diagnosticReport, teacherNotes: session2.teacherNotes },
            log: session2.log || []
          }));
          return;
        }

        if (pathname === "/api/session" && method === "PATCH") {
          var claims5 = getClaims(headersInit);
          if (!claims5 || claims5.kind === "student") { resolve(jsonResponse(403, { error: "Teacher access required" })); return; }
          var session3 = sessions.find(function (s) { return s.id === body.sessionId; });
          if (!session3) { resolve(jsonResponse(404, { error: "Session not found" })); return; }
          if (body.diagnosticReport !== undefined) session3.diagnosticReport = body.diagnosticReport;
          if (body.teacherNotes !== undefined) session3.teacherNotes = body.teacherNotes;
          resolve(jsonResponse(200, { ok: true }));
          return;
        }

        if (pathname === "/api/session" && method === "DELETE") {
          var claims6 = getClaims(headersInit);
          if (!claims6 || claims6.kind === "student") { resolve(jsonResponse(403, { error: "Teacher access required" })); return; }
          var delSessionId = u.searchParams.get("sessionId");
          var idx1 = sessions.findIndex(function (s) { return s.id === delSessionId; });
          if (idx1 === -1) { resolve(jsonResponse(404, { error: "Session not found" })); return; }
          sessions.splice(idx1, 1);
          resolve(jsonResponse(200, { ok: true }));
          return;
        }

        if (pathname === "/api/teacher-roster" && method === "GET") {
          var claims7 = getClaims(headersInit);
          if (!claims7 || claims7.kind === "student") { resolve(jsonResponse(401, { error: "Missing or expired access token", tokenInvalid: true })); return; }
          var qStudentId = u.searchParams.get("studentId");
          if (qStudentId) {
            var studentDetail = students.find(function (s) { return s.id === qStudentId && s.label === claims7.label; });
            if (!studentDetail) { resolve(jsonResponse(404, { error: "Student not found" })); return; }
            var studentSessions = sessions.filter(function (s) { return s.studentId === qStudentId; });
            var studentWords = [];
            studentSessions.forEach(function (s) { studentWords = studentWords.concat(s.log || []); });
            var studentStats = computeStatsBreakdown(studentWords);
            studentStats.sessionCount = studentSessions.length;
            resolve(jsonResponse(200, {
              student: { id: studentDetail.id, fullName: studentDetail.fullName },
              sessions: studentSessions.map(function (s) {
                var words = s.log || [];
                var solved = words.filter(function (w) { return !w.skipped; });
                return {
                  id: s.id, passageTitle: s.passageTitle, passageEmoji: s.passageEmoji, startedAt: s.startedAt, finishedAt: s.finishedAt,
                  wordCount: words.length,
                  comprehensionCorrect: s.comprehensionResult ? (s.comprehensionResult.correct === undefined ? null : s.comprehensionResult.correct) : null,
                  teacherNotes: s.teacherNotes || null,
                  independentCount: solved.filter(function (w) { return w.hintsUsed === 0; }).length,
                  totalCount: solved.length,
                };
              }),
              studentStats: studentStats,
              wordHistory: buildWordHistory(studentSessions),
              calibration: computeCalibration(studentWords)
            }));
            return;
          }
          var classIdFilter = u.searchParams.get("classId");
          var scopedStudents = students.filter(function (s) { return s.label === claims7.label; });
          if (classIdFilter === "none") {
            scopedStudents = scopedStudents.filter(function (s) { return !s.classId; });
          } else if (classIdFilter) {
            scopedStudents = scopedStudents.filter(function (s) { return s.classId === classIdFilter; });
          }
          var contributingStudents = 0;
          var allWords = [];
          var roster = scopedStudents.map(function (s) {
            var studentSessions2 = sessions.filter(function (sess) { return sess.studentId === s.id; });
            var ownWords = [];
            studentSessions2.forEach(function (sess) { ownWords = ownWords.concat(sess.log || []); });
            if (studentSessions2.length > 0) {
              contributingStudents += 1;
              allWords = allWords.concat(ownWords);
            }
            var lastSessionAt = null;
            studentSessions2.forEach(function (sess) { if (!lastSessionAt || sess.finishedAt > lastSessionAt) lastSessionAt = sess.finishedAt; });
            var weakest = weakestClueType(computeStatsBreakdown(ownWords).breakdown);
            return {
              id: s.id, fullName: s.fullName, createdAt: s.createdAt, lastLoginAt: s.lastLoginAt, classId: s.classId,
              sessionCount: studentSessions2.length, lastSessionAt: lastSessionAt,
              weakestClueType: weakest ? { type: weakest.type, independent: weakest.independent, total: weakest.total } : null,
            };
          });
          var classStats = computeStatsBreakdown(allWords);
          classStats.studentCount = contributingStudents;
          var teacherClasses = classes.filter(function (c) { return c.label === claims7.label; }).map(function (c) { return { id: c.id, name: c.name }; });
          resolve(jsonResponse(200, { students: roster, classStats: classStats, classes: teacherClasses }));
          return;
        }

        if (pathname === "/api/teacher-roster" && method === "POST") {
          var claimsPost = getClaims(headersInit);
          if (!claimsPost || claimsPost.kind === "student") { resolve(jsonResponse(401, { error: "Missing or expired access token", tokenInvalid: true })); return; }
          var newClassName = typeof body.name === "string" ? body.name.trim() : "";
          if (!newClassName || newClassName.length > 60) { resolve(jsonResponse(400, { error: "Class name must be 1-60 characters" })); return; }
          var newCls = { id: String(nextClassId++), name: newClassName, label: claimsPost.label };
          classes.push(newCls);
          resolve(jsonResponse(200, { class: { id: newCls.id, name: newCls.name } }));
          return;
        }

        if (pathname === "/api/teacher-roster" && method === "PATCH") {
          var claimsPatch = getClaims(headersInit);
          if (!claimsPatch || claimsPatch.kind === "student") { resolve(jsonResponse(401, { error: "Missing or expired access token", tokenInvalid: true })); return; }
          if (body.kind === "renameClass") {
            var clsToRename = classes.find(function (c) { return c.id === body.classId && c.label === claimsPatch.label; });
            if (!clsToRename) { resolve(jsonResponse(404, { error: "Class not found" })); return; }
            var renamedTo = typeof body.name === "string" ? body.name.trim() : "";
            if (!renamedTo || renamedTo.length > 60) { resolve(jsonResponse(400, { error: "Class name must be 1-60 characters" })); return; }
            clsToRename.name = renamedTo;
            resolve(jsonResponse(200, { ok: true }));
            return;
          }
          if (body.kind === "assignStudent") {
            var studentToMove = students.find(function (s) { return s.id === body.studentId && s.label === claimsPatch.label; });
            if (!studentToMove) { resolve(jsonResponse(404, { error: "Student not found" })); return; }
            var targetClassId = body.classId === undefined ? null : body.classId;
            if (targetClassId !== null) {
              var targetCls = classes.find(function (c) { return c.id === targetClassId && c.label === claimsPatch.label; });
              if (!targetCls) { resolve(jsonResponse(404, { error: "Class not found" })); return; }
            }
            studentToMove.classId = targetClassId;
            resolve(jsonResponse(200, { ok: true }));
            return;
          }
          resolve(jsonResponse(400, { error: "Invalid kind" }));
          return;
        }

        if (pathname === "/api/teacher-roster" && method === "DELETE") {
          var claims8 = getClaims(headersInit);
          if (!claims8 || claims8.kind === "student") { resolve(jsonResponse(401, { error: "Missing or expired access token", tokenInvalid: true })); return; }
          var delClassId = u.searchParams.get("classId");
          if (delClassId) {
            var classIdx = classes.findIndex(function (c) { return c.id === delClassId && c.label === claims8.label; });
            if (classIdx === -1) { resolve(jsonResponse(404, { error: "Class not found" })); return; }
            classes.splice(classIdx, 1);
            students.forEach(function (s) { if (s.classId === delClassId) s.classId = null; });
            resolve(jsonResponse(200, { ok: true }));
            return;
          }
          var delStudentId = u.searchParams.get("studentId");
          var idx2 = students.findIndex(function (s) { return s.id === delStudentId && s.label === claims8.label; });
          if (idx2 === -1) { resolve(jsonResponse(404, { error: "Student not found" })); return; }
          students.splice(idx2, 1);
          for (var i = sessions.length - 1; i >= 0; i--) if (sessions[i].studentId === delStudentId) sessions.splice(i, 1);
          resolve(jsonResponse(200, { ok: true }));
          return;
        }

        resolve(jsonResponse(404, { error: "Not found" }));
      }, 120);
    });
  };
})();
`;

const outDir = path.join(root, "dist-offline");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "GIST-offline-demo.html");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>G.I.S.T. — Guided Inference Skill Trainer (offline demo)</title>
<style>
${appCss}
</style>
</head>
<body>
<div id="root"></div>
<script>${mockScript}</script>
<script type="module">
${appJs}
</script>
</body>
</html>
`;

fs.writeFileSync(outFile, html, "utf8");
console.log(`Built ${outFile} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
console.log("Just double-click that file (or drag it into a browser tab) -- no Node, no terminal, no install needed.");
