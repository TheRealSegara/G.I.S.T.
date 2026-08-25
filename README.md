# G.I.S.T. — Guided Inference Skill Trainer

An AI-powered vocabulary and reading comprehension assessment tool built for Malaysian primary school ESL students (Year 4–6).

G.I.S.T. asks students to work out unfamiliar words directly from context, guided by one of eight animal coach personas, never handed the answer outright. It includes a reliability layer that checks whether a correct answer reflects real understanding or a lucky guess, and produces a plain-language diagnostic report for the teacher after each session. Student accounts persist that report across sessions, so a teacher can track one student's progress over time, not just glance at a single session in isolation.

Built for the Petrosains AI Educator Challenge 2026.

## For teachers: what this actually is

You don't need to read the rest of this file to understand the project — it's here for anyone deploying or maintaining it.

G.I.S.T. is a short, guided activity a student plays on a tablet or laptop, with a teacher nearby. The first time, a student signs up with their name and picks 3 secret animals (a simple, kid-friendly login, not a real password) — after that, they log back in the same way each session, so their progress builds up over time instead of starting from zero each visit. The student picks a reading passage; an AI "coach" (one of eight animal characters) walks them through 3–5 tricky vocabulary words, one at a time, always making them work the meaning out from context, never just telling them the answer. Afterward, you (the teacher) get a plain-language report: which words the student genuinely understood, which they only guessed at, and one concrete thing to try in your next lesson — no jargon, no dashboards to interpret. Every student's reports collect in your **File Box**, so you can check on anyone's progress at any time, not just right after they finish playing.

**Wanting to try it with your own class?** You don't need to set any of this up yourself — ask whoever manages the deployed link for your class's access code, then just open the link on a device and go. If you're interested in running your *own* copy (a different school, your own Google account, full control over it), everything below is what a technical setup helper would need — it's more detail than a teacher needs day-to-day, but it's what makes it possible for someone else to stand up their own instance.

## AI calls run through a server-side proxy

Every AI feature in this app, coaching dialogue, the diagnostic report, the level maker, the comprehension question, calls a single function, `callClaude()` in `src/App.jsx`, which posts to `/api/claude`. That endpoint is a Vercel serverless function (`api/claude.js`) that holds a real API key server-side and forwards the request to the upstream model. The key is never sent to the browser.

The proxy currently calls **Groq's API** (free tier, no credit card required, OpenAI-compatible chat completions shape), not Anthropic, chosen to avoid billing during early testing (an earlier version used Google's Gemini API; Groq replaced it for a far more generous free tier and much faster inference). It translates Groq's request/response shape internally so `App.jsx` doesn't need to know or care which provider is behind `/api/claude`, that's still the one function every AI feature goes through, same as before. Swapping providers again later (e.g. to Anthropic once budget allows) only means rewriting `api/claude.js`, not the frontend.

The proxy also applies several protections before forwarding a request:

- **Method restriction**: only `POST` is accepted. On Vercel this is rejected at the edge, before the request even reaches the Node function (see `middleware.js` below).
- **Origin allowlist**: if `ALLOWED_ORIGINS` is set, requests must come from one of those origins; otherwise the request is rejected. Leave it unset during initial setup, set it before sharing the deployed link publicly. Also enforced at the edge on Vercel.
- **Access-code gate**: every request to `/api/claude` must carry a valid, short-lived `Authorization: Bearer <token>` header, obtained by first calling `/api/auth` with a code from `ACCESS_CODES`. See [Access codes](#access-codes-lightweight-multi-teacherschool-auth) below.
- **Per-code daily quota**: each access code is capped at `DAILY_QUOTA_PER_CODE` requests/day (default 200), tracked by the label embedded in its token, independent of IP. This is set conservatively under Groq's own free-tier ceiling (see [Groq's free-tier ceiling](#groqs-free-tier-ceiling-read-this-before-a-real-classroom-day) below) — going higher doesn't unlock more real usage.
- **Payload validation**: model name, prompt/message lengths, and message count are checked against fixed limits before the request is forwarded.
- **`max_tokens` cap**: forwarded requests are capped regardless of what the client sends.
- **Best-effort rate limiting**: a per-instance in-memory limiter (`RATE_LIMIT_MAX_REQUESTS`, default 30/minute/IP, matching Groq's actual free-tier RPM ceiling directly rather than a hand-estimated fraction of it — two smaller estimates were tried first and both proved too tight against real single-student play). Since serverless instances are short-lived and not shared, this isn't a global guarantee, it deters casual abuse of a warm instance, not a determined attacker. The real global backstop is the Vercel Firewall rule described below.

The proxy logic itself lives in `api/_claudeHandler.js`, shared between two entry points depending on how you deploy (see below): `api/claude.js` (a Vercel serverless function) and `server.js` (a plain Node/Express server for container-based hosts). The access-code logic follows the same split: `api/_authHandler.js` shared by `api/auth.js` (Vercel) and `server.js`.

## Groq's free-tier ceiling (read this before a real classroom day)

The **free tier with no billing account linked** — what this project deliberately uses, to keep the risk of an unexpected bill at literally zero — has a real ceiling worth planning around: for `openai/gpt-oss-20b` (the current default; switched from `llama-3.1-8b-instant`, which Groq decommissioned on 2026-08-16), **30 requests/minute, 8,000 tokens/minute, 1,000 requests/day, 200,000 tokens/day**, shared by your whole API key, not per access code or per student. The token limits bind before the request-count ones do for this app: the coach's own system prompt runs ~1,800–1,900 tokens per call, so in practice the real per-minute ceiling is closer to 4 calls, not 30. Check your own live numbers at [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits) — they can vary by account and model.

One full student session (working through 3 vocabulary words, plus the transfer test, comprehension check, and diagnostic report) uses roughly 10–20 AI calls on its own. That works out to **roughly 5–10 full sessions per day, school-wide**, before the daily token ceiling kicks in. This is noticeably tighter than the old `llama-3.1-8b-instant` free tier (14,400 requests/day, 500,000 tokens/day, good for 20+ sessions/day) — Groq's replacement model's free tier is smaller on both requests/day and tokens/day, so budget classroom usage accordingly, and be extra deliberate about not burning quota on last-minute testing right before a live demo or judging session.

`RATE_LIMIT_MAX_REQUESTS` and `DAILY_QUOTA_PER_CODE` (see below) are deliberately set under this ceiling, so a student sees G.I.S.T.'s own clear "try again" message instead of a raw error from Groq. Raising them doesn't unlock more real usage — Groq's limit is what actually stops the request either way. The only way to raise the real ceiling is moving to a paid Groq tier, a deliberate tradeoff this project has chosen not to make.

## Access codes (lightweight multi-teacher/school auth)

G.I.S.T. doesn't have real user accounts, there's no database to hold them. Instead, access is gated by shared codes you distribute to teachers or schools:

1. Set `ACCESS_CODES` (see `.env.example`) to a comma-separated list, e.g. `ACCESS_CODES=apple123:SMK Jaya,banana456:SMK Bukit`. The part after `:` is just a label used for quota tracking; you can omit it (`ACCESS_CODES=apple123,banana456`) and the code itself is used as the label.
2. Set `AUTH_SECRET` to any long random string (e.g. `openssl rand -hex 32`). This signs the short-lived session tokens issued after a correct code; it must stay secret and should differ from `GROQ_API_KEY`.
3. On first load, the app shows an access-code screen. A correct code exchanges for a signed token (`/api/auth`), cached in the browser's `sessionStorage` (cleared when the tab closes) for `TOKEN_TTL_MINUTES` (default 720 = 12h, a school day plus margin). Every `/api/claude` call after that carries the token; an expired or missing token gets a 401 and the app re-shows the code screen.
4. Rotate access by editing `ACCESS_CODES` and redeploying — there's nothing to revoke elsewhere, since codes aren't tied to accounts.

This protects your Groq quota/cost from random internet traffic; it is **not** meant to protect sensitive data — access codes gate the AI proxy, not the student data described below.

## Student accounts and the database

An access code unlocks the *device* for a school; a student account is what makes G.I.S.T. useful across more than one sitting. After "Start Playing," a student chooses **New Student** (enter a full name, then pick 3 secret animals in order, remembered for next time) or **Returning Student** (re-enter both to resume). That account is what a completed session gets saved against, so the teacher's **File Box** (reachable from the main menu's Teachers panel) can list every student who's signed up under this access code and drill into any of their past sessions' full diagnostic reports.

**The student "password" is a 3-animal secret, not a real password.** This is a supervised-classroom access gate for tracking progress across sessions, not a security boundary — the pool is only 8 animals, so a 3-in-sequence secret is roughly 1 in 500, deliberately weak in exchange for being usable by a 9-year-old with no keyboard skills required. Two things keep it reasonable anyway: it's a *separate* secret from the student's visible coach companion (never shown on screen again after signup, unlike the companion emoji that's visible throughout gameplay, so a classmate who's watched someone play can't just read their password off the screen), and the login/signup endpoint rate-limits attempts server-side.

**Setup, one-time:**

1. Create a free project at [supabase.com](https://supabase.com) (the free tier is enough for classroom use).
2. In the Supabase dashboard, open **SQL Editor → New query**, paste the entire contents of `supabase/schema.sql` from this repo, and run it. This creates four tables (`classes`, `students`, `sessions`, `session_words`) with Row Level Security enabled and **no policies** for the anon/authenticated roles — the anon key alone grants zero access. Every statement in it is idempotent (`create ... if not exists`), so it's always safe to re-run against an existing project — do that whenever this file changes (e.g. after pulling an update that adds a table or column) to pick up the new schema.
3. From **Project Settings → API**, copy the **Project URL** into `SUPABASE_URL`, and the **service role key** (not the anon/public key) into `SUPABASE_SERVICE_ROLE_KEY`. Set both in Vercel's Environment Variables (or `.env.local` for local dev) and redeploy.

The service role key bypasses RLS entirely, which is exactly why every table has RLS enabled with no policies: only this key — used solely by this app's own server-side API routes (`api/_supabase.js`, never imported by anything shipped to the browser) — can read or write student data. There's no Supabase Auth involved; authorization follows the same custom access-code/token model as the rest of the app (`api/_studentAuthHandler.js`, `api/_sessionHandler.js`, `api/_teacherRosterHandler.js`), just with a second, separately-scoped token issued after a student's own name+secret check.

Until `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set, the New/Returning Student screens will show a clear "server is missing" error rather than failing silently — there's no anonymous-play fallback, since persisting progress across sessions is the whole point of this feature.

## Rotating keys and secrets

All secret values (`GROQ_API_KEY`, `AUTH_SECRET`, `ACCESS_CODES`, `SUPABASE_SERVICE_ROLE_KEY`) live only in Vercel's Environment Variables (or your host's equivalent) — rotating any of them is: generate/obtain a new value, update it there, redeploy. None of them are referenced anywhere else, so nothing else needs updating.

- **`GROQ_API_KEY`**: rotate immediately (delete the old key at console.groq.com/keys, generate a new one) if it's ever pasted into a chat, screenshot, commit, or anywhere outside Vercel's UI. Do this periodically regardless, as routine hygiene.
- **`AUTH_SECRET`**: rotating it instantly invalidates every currently-issued access token (teacher *and* student), forcing everyone to re-enter their access code — harmless on its own, no session data is lost by design. **But** this value also doubles as the pepper hashing every student's 3-animal secret (`api/_studentAuth.js`), so rotating it makes every *already-registered* student's secret permanently unverifiable — they can't log back in with the secret they remember, and can't just re-sign-up either, since their name is still taken. Only rotate this if you're prepared to have already-enrolled students re-registered by a teacher (or extend the schema/handler to re-hash on rotation, not implemented here).
- **`ACCESS_CODES`**: see step 4 above — just edit the list.
- **`SUPABASE_SERVICE_ROLE_KEY`**: rotate from the same Project Settings → API page immediately if it's ever exposed the same way as `GROQ_API_KEY`. Rotating it doesn't affect any stored data, only which key the app itself uses to reach it.

## Vercel Firewall rate-limit rule (recommended, dashboard-only)

`middleware.js` and the in-memory limiter in `_claudeHandler.js` only go so far. For a real, globally-enforced cap, add a Vercel Firewall rule after your first deploy (free on the Hobby plan, 1 rule/project):

1. Open your project on vercel.com → **Firewall** → **Configure** → **+ New Rule**.
2. Condition: request path starts with `/api/`.
3. Action: **Rate Limit**, algorithm **Fixed Window**, e.g. 100 requests per 60s, keyed by **IP**.
4. Action on exceeding the limit: **Deny** (or **Challenge**, if you want a browser challenge instead of a hard block).
5. Save, review changes, **Publish**.

This blocks abusive IPs before your function runs at all, on top of the access-code gate above.

## Tech stack

- React 18 + Vite
- Tailwind CSS
- lucide-react (icons)
- Browser's native `SpeechSynthesis` API for text-to-speech (no external dependency)
- Vercel serverless function or Express server for the Groq API proxy (`api/claude.js` / `server.js`)
- Supabase (Postgres) for student accounts and session history — access-code auth still gates the app itself (see [Access codes](#access-codes-lightweight-multi-teacherschool-auth)); Supabase only holds what a signed-in student's account needs to persist (see [Student accounts and the database](#student-accounts-and-the-database) above). No Supabase Auth, no RLS policies — a custom service-role-only access model, same philosophy as the rest of the app's auth.

## Getting started

1. Copy `.env.example` to `.env.local` and set `GROQ_API_KEY` (get one free at console.groq.com/keys), `ACCESS_CODES`, `AUTH_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` (see [Student accounts and the database](#student-accounts-and-the-database) above for the Supabase setup steps — run `supabase/schema.sql` in the Supabase SQL Editor first). Set `ALLOWED_ORIGINS` once you have a deployed URL.
2. Install dependencies and run with the Vercel CLI so the `/api` functions and edge middleware are served alongside the frontend:

```bash
npm install
npm i -g vercel   # if you don't already have it
vercel dev
```

Running `vite` directly (`npm run dev`) serves the frontend only; `/api/claude` won't resolve without `vercel dev` or an equivalent proxy setup.

## Deploying to Vercel

1. Import the repo into a new Vercel project (framework preset: Vite).
2. In the project's Environment Variables, set `GROQ_API_KEY` (your free key from console.groq.com/keys), `ACCESS_CODES`, `AUTH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGINS` (your deployed domain, e.g. `https://your-app.vercel.app`). See [Access codes](#access-codes-lightweight-multi-teacherschool-auth) and [Student accounts and the database](#student-accounts-and-the-database) above.
3. Deploy. Vercel builds the frontend (`npm run build` → `dist/`), picks up every file directly under `api/` (not prefixed with `_`) as its own serverless function, and `middleware.js` as edge middleware, automatically.
4. After the first deploy, add the [Vercel Firewall rate-limit rule](#vercel-firewall-rate-limit-rule-recommended-dashboard-only) above.

## Deploying to a container host (e.g. Cloud Run)

Container-based hosts don't run per-file serverless functions the way Vercel does, they expect a single process that starts and listens on `process.env.PORT`. `server.js` is that process: it serves the built frontend and handles `/api/claude` itself via Express.

1. Set `GROQ_API_KEY`, `ACCESS_CODES`, `AUTH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGINS` as environment variables/secrets in the host's project settings.
2. The host should run `npm install`, then `npm run build` (or the `gcp-build` script, which does the same thing, some GCP buildpacks run this automatically), then `npm start` (`node server.js`). If the host lets you set a build/start command explicitly, use those.
3. If a deploy fails with something like "container failed to start and listen on the port", it means the host isn't running `npm start`, double check the build/start command configuration rather than the app code.
4. Only set `TRUST_PROXY_HOPS=1` if this container sits behind the host's own reverse proxy/load balancer (true for Cloud Run). Leave it unset on any host where the process might be reachable directly, otherwise a client can fake their own IP via the `X-Forwarded-For` header and slip past the rate limiter and the access-code brute-force guard.

## Project structure

```
├── api/
│   ├── claude.js                # Vercel serverless function entry point
│   ├── _claudeHandler.js        # The actual proxy logic (Groq call + auth + protections), shared with server.js
│   ├── auth.js                  # Vercel serverless function entry point for the access-code exchange
│   ├── _authHandler.js          # Access-code validation + token issuing, shared with server.js
│   ├── _auth.js                 # Shared HMAC token sign/verify helpers
│   ├── student-auth.js          # Vercel serverless function entry point for student signup/login
│   ├── _studentAuthHandler.js   # Signup/login logic, shared with server.js
│   ├── _studentAuth.js          # Secret hashing, name normalization, allowed-value lists
│   ├── session.js               # Vercel serverless function entry point for saving/reading a session
│   ├── _sessionHandler.js       # Save (student) / read + cache diagnostic (teacher) logic, shared with server.js
│   ├── teacher-roster.js        # Vercel serverless function entry point for the File Box roster
│   ├── _teacherRosterHandler.js # Roster + per-student session list logic, shared with server.js
│   ├── _supabase.js             # Supabase client singleton, service-role key only
│   └── _shared.js               # Origin/IP checks, in-memory Map pruning, DAILY_QUOTA_PER_CODE
├── supabase/
│   └── schema.sql                # One-time migration: run in the Supabase SQL Editor
├── middleware.js              # Vercel Edge Middleware: rejects bad method/origin before functions run
├── server.js                 # Node/Express server for container-based hosts (Cloud Run, etc.)
├── index.html
├── src/
│   ├── main.jsx      # React entry point
│   ├── App.jsx        # The entire application (single file, see note below)
│   └── index.css      # Tailwind entry point
├── tailwind.config.js
├── vite.config.js
└── package.json
```

`src/App.jsx` is intentionally a single large file. It was built iteratively as a Claude Artifact, where the whole app lives in one component tree without a build step. It has not yet been split into smaller modules, that would be a reasonable next step for long-term maintainability but wasn't a priority while iterating quickly on features.

## Architecture notes

- **Student accounts persist across sessions; the device itself doesn't assume one student per sitting.** A student signs up or logs back in after "Start Playing," so their session history accumulates in Supabase and shows up in the teacher's File Box, rather than existing only until the tab closes. A shared classroom device still works the same way session-to-session: the "New Student" button (in the passage screen's header) clears the current student's identity and in-progress state without touching the teacher's own access-code session, so the device can be handed off cleanly. Downloading a session's report as a standalone HTML file (printable to PDF) still works too, as a local backup independent of the database.
- **Bilingual support (EN/BM) is scoped to the onboarding tutorial only**, not gameplay. This was a deliberate decision, gameplay stays fully English-immersion; the tutorial is the one place a struggling reader gets Bahasa Malaysia support before the actual assessment begins.
- **The diagnostic report is intentionally jargon-free.** Internal data labels (clue type, transfer test, prior knowledge) are never surfaced to the teacher as-is, every finding is translated into plain language explaining what it actually means for the student.

## Status

Functionally complete and iteratively tested within the Claude Artifacts environment across many rounds of real-device testing. **Not yet validated in a real classroom with a real student** as of this writing, that's the next and most important step before treating this as finished.
