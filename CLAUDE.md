# G.I.S.T. (Guided Inference Skill Trainer)

An AI vocabulary and reading-comprehension coach for Malaysian primary school
(Year 4-6) ESL students, built for the PetroSains AI Educator Challenge 2026.
A student picks a passage, works through a handful of target words with an AI
coach that escalates through five adaptive stages of difficulty per word
(recognize → produce → discriminate → apply → create), then a separate AI
reads back over the whole finished session and writes a plain-language
diagnostic report for the teacher — not a score, a specific evidence-backed
picture of where the student's understanding is solid and where it isn't.

The coach is under a hard rule to never state a word's dictionary definition
directly — the whole point is inference practice from context clues, not a
look-up tool. This constraint should be preserved in any future change to the
coaching prompts.

## Architecture

- **Frontend**: single-file React 18 + Vite SPA at `src/App.jsx` (~8000+
  lines — every screen, from the access gate to the teacher's File Box, lives
  in this one file).
- **Backend**: Vercel serverless functions acting as a thin AI proxy to
  Groq (free tier) — the browser never holds an API key. Entry points are
  `api/*.js` (thin wrappers) calling shared `api/_*Handler.js` logic, which
  is also reused by `server.js` (a plain Express server for non-Vercel
  hosting, e.g. Cloud Run).
- **Database**: Supabase (Postgres), schema in `supabase/schema.sql`. RLS is
  enabled with **no policies** — only the service-role key (server-side only)
  can read/write. All authorization is enforced in application code, not
  Supabase Auth or RLS.
- **Offline demo mocks**: `scripts/local-demo-server.mjs` (Express, ESM) and
  `scripts/build-offline-demo.mjs` (bundles a standalone single-file browser
  demo, ES5-style). Both must be kept in sync with the real `api/_*Handler.js`
  logic whenever auth, session, or roster behavior changes — this has been a
  recurring source of drift bugs.
- **Middleware**: `middleware.js` is Vercel Edge Middleware — a cheap
  method/origin check in front of the Node functions, defense-in-depth only
  (every handler still enforces its own checks).

## Auth model (current, post-simplification)

- **Teacher/school**: one shared access code per school/class (`ACCESS_CODES`
  env var), exchanged for a short-lived signed token via `/api/auth`.
- **Student**: identified by **full name alone** — no password, no secret
  sequence. The 3-animal "secret" login that existed earlier in development
  was deliberately removed; the DB's unique `(access_code_label,
  full_name_key)` index already prevents same-school name collisions, so a
  second credential added friction without adding real security for a
  supervised-classroom tool. Do not reintroduce a per-student secret without
  a real reason — this was a considered removal, not an oversight.
- Two "kinds" of signed token exist: `teacher` and `student`. Handlers must
  check `claims.kind` before trusting either one for a given endpoint.

## Demo Mode

A presenter-facing toggle that swaps every AI call for instant, deterministic
scripted replies, skips real signup/session-saving, and — for a **new**
student signup specifically — skips straight from name entry to level
selection, bypassing the coach-companion and avatar-builder wizard steps
entirely (see `SetupScreen`'s `handleContinue`, gated on `demoModeActive`).
This exists purely to make repeated live demos fast; real student signup is
unaffected. File Box shows a synthetic in-memory roster in Demo Mode.

## The diagnostic report

`TeacherScreen` (in `App.jsx`) renders the report; `buildReportHtml`/
`downloadReport` produce the printable/downloaded version and must be kept
in content-parity with the live report — this has drifted before. Key
always-visible evidence cards: At a Glance, Class Pattern (cross-student
comparison), Growth Over Time (session-over-session chart), Recurring Words,
Transfer Check, Concrete vs Abstract, flagged-words-for-reteaching. A blue
footer line ("Counted directly from the log, not AI") marks
deterministically-computed content; amber marks AI-written content — this
color convention is load-bearing, don't break it.

`hasHistory` (student has 2+ sessions) and `canShowHistoryToggle`
(`hasHistory && !hideResetSection`) are deliberately separate: the latter
only suppresses the nested History-toggle section to avoid infinite nesting
when a past session is opened from File Box/History, and must never be used
to gate the Growth Over Time / Recurring Words cards themselves — that was a
real bug, already fixed once.

## Verification workflow

1. `npm run build`
2. Start the offline demo server in background:
   `setsid nohup node scripts/local-demo-server.mjs > /tmp/... 2>&1 < /dev/null &`
   (needs `dangerouslyDisableSandbox: true`; plain backgrounding is flaky in
   this environment)
3. Playwright scripts against `http://localhost:4000` for UI verification,
   or direct `fetch` calls against the same server for backend-only checks
4. Screenshot inspection where relevant
5. Commit, push to the feature branch, fast-forward-merge to `main`, push
   `main`, checkout back to the feature branch

Never fake sample/fixture data to force a feature to visually demonstrate
itself if the real underlying data doesn't support it (e.g., a passage whose
real word bank is 100% abstract should not be given fake concrete words just
to show off a concreteness-breakdown card) — verify via a separate live test
with genuinely different data instead.

## Git

Primary feature branch: `claude/gist-vercel-deployment-x74b1c`. Fast-forward
merge to `main` after verification (no separate PR workflow established).

## Project context

Submitted to the PetroSains AI Educator Challenge 2026 (portfolio, teaching
aid, and demo video). The portfolio PDF documents testing with 2 real
students + 1 real teacher in Sarawak (11 & 13 Aug 2026), which surfaced and
led to fixing a coach grading-accuracy bug and an overly jargon-heavy report
— both described as fixed in the current codebase. A judged live-demo pitch
was prepared for "Road to PetroSains AI Summit 2027" but the team was not
selected to advance past the portfolio round.
