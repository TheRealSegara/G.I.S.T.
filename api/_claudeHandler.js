// Shared request handler for the AI proxy. Used by both api/claude.js
// (Vercel serverless function) and server.js (Cloud Run / generic Node
// hosting), so the proxy logic and its protections live in exactly one
// place. Filename is prefixed with "_" so Vercel's file-system routing
// doesn't turn it into its own route.
//
// Internally this calls Groq's API (free tier, OpenAI-compatible chat
// completions shape) rather than Anthropic's, but translates the
// request/response to the same shape Anthropic's Messages API uses, so
// callClaude() in App.jsx needs no changes: { content: [{ type: "text",
// text: "..." }] }. Chose Groq over Gemini (the original provider) for
// its far more generous free tier and much faster inference — see the
// git history / commit messages around this change for the comparison.

import { verifyToken } from "./_auth.js";
import { isOriginAllowed, getClientIp, pruneIfLarge, isPlainObjectWithOnlyKeys, createRateLimiter, getBearerToken, DAILY_QUOTA_PER_CODE } from "./_shared.js";
import {
  SESSION_WORD_COUNT,
  CLUE_TYPES,
  COMPANION_PERSONAS,
  STAGE1_CYCLE,
  STAGE2_CYCLE,
  STAGE3_CYCLE,
  buildCoachSystemPrompt,
  TRANSFER_TEST_SYSTEM_PROMPT,
  COMPREHENSION_SYSTEM_PROMPT,
  SINGLE_WORD_REGEN_PROMPT,
  LEVEL_MAKER_SYSTEM_PROMPT,
  PASSAGE_STARTER_SYSTEM_PROMPT,
  DIAGNOSTIC_SYSTEM_PROMPT,
} from "../shared/prompts.js";

// The exact, complete shape callClaude() in App.jsx is allowed to send.
// Anything outside this (extra top-level fields, extra fields on a
// message) is rejected outright rather than silently ignored. Note there
// is no "system" field: the client sends a promptId (+ params for the one
// parameterized prompt) and the server builds the real system prompt
// itself from shared/prompts.js -- see PROMPT_BUILDERS below.
const ALLOWED_BODY_KEYS = ["model", "promptId", "params", "messages", "max_tokens"];
const ALLOWED_MESSAGE_KEYS = ["role", "content"];
const ALLOWED_COACH_PARAM_KEYS = ["companionId", "stage1Type", "stage2Type", "stage3Type"];
const ALLOWED_PASSAGE_STARTER_PARAM_KEYS = ["clueType"];

// llama-3.1-8b-instant was decommissioned by Groq on 2026-08-16; this
// default was switched to their recommended replacement ahead of that
// date. See the RATE_LIMIT_MAX_REQUESTS and DAILY_QUOTA_PER_CODE comments
// below/in _shared.js — the free-tier ceiling for this model is NOT the
// same shape as the old one (RPD and TPD both dropped, TPM went up
// slightly), so those were retuned alongside this, not just the name.
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const ALLOWED_MODEL = "claude-sonnet-4-6"; // the model name App.jsx still sends; unused beyond validation
const MAX_TOKENS_CAP = 1000;
// The diagnostic report is the one call that genuinely needs more room:
// it writes five separate fields (summary, core pattern, how reliable,
// story understanding, what to try), three of which require a headline
// sentence plus 2-4 bullet points each — comfortably more prose than any
// other call in the app produces. At the shared MAX_TOKENS_CAP this was
// getting cut off mid-JSON (seen live), which safeParseJSON in App.jsx
// can't repair since the content was never generated, not just malformed
// — so every attempt failed with "Response wasn't valid JSON" instead of
// a usable report. Still well inside Groq's shared 8,000 TPM ceiling for
// a single call (see DAILY_QUOTA_PER_CODE in _shared.js for the other
// numbers), and gated to only this one prompt (see isDiagnosticPrompt
// below) so every other, lighter call keeps the tighter default cap.
// Bumped from 1800 to 2400: the openai/gpt-oss-20b switch above brought
// this model family's reasoning step with it (see REASONING_PARAMS below)
// — reasoning tokens are drawn from this same max_tokens budget before
// the model ever starts writing the actual JSON answer, so the diagnostic
// prompt (the most demanding one) needs real headroom even with
// reasoning effort turned down, not just the old llama-3.1 cap.
const DIAGNOSTIC_MAX_TOKENS_CAP = 2400;
// openai/gpt-oss-20b (and gpt-oss-120b) are reasoning models: by default
// (reasoning_effort: "medium", undocumented but confirmed via Groq's own
// docs at console.groq.com/docs/reasoning) they spend a meaningful chunk
// of max_tokens on an internal reasoning pass before writing the final
// answer — for a demanding prompt like the diagnostic report, that
// reasoning pass alone could consume the entire token budget, leaving
// `message.content` empty and every safeParseJSON attempt in App.jsx
// failing with "Response wasn't valid JSON", consistently, every call.
// "low" cuts that reasoning pass down substantially so the actual JSON
// answer reliably gets written within the cap. include_reasoning: false
// keeps any reasoning content out of the response entirely (Groq's
// default already puts it in a separate `reasoning` field rather than
// mixing it into `content`, but there are live community reports of
// reasoning/gibberish leaking into `content` regardless — see
// community.groq.com's gpt-oss-120b thread — so this is a deliberate
// extra safety margin, not redundant). Both keys are harmless no-ops if
// GROQ_MODEL is ever pointed at a non-reasoning model; Groq's API (like
// OpenAI's) ignores parameters a given model doesn't understand.
const REASONING_PARAMS = { reasoning_effort: "low", include_reasoning: false };
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 8000;

// Server-owned prompt authority: the client sends a promptId (+ narrow,
// allow-listed params for the one parameterized prompt, "coach") and
// NEVER a literal system-prompt string. Each builder below either returns
// the real, fixed prompt text straight from shared/prompts.js, or — for
// "coach" — validates its params against an explicit enum allow-list
// before calling buildCoachSystemPrompt(), returning null on anything
// that doesn't match so the handler can reject it with a 400.
//
// This replaces an earlier approach that trusted a client-supplied
// "system" string as long as it *started with* a known fixed prefix — a
// caller who already knew one of those prefixes could prepend it verbatim
// and then append arbitrary malicious continuation text, since nothing
// checked the rest of the string. Now the client can't send prompt text
// at all, so there's nothing to append to: the server reconstructs the
// exact prompt itself from these fixed builders every time. (The prompt
// TEXT itself isn't secret — it's also visible in the client bundle, e.g.
// for the "Build Your Own G.I.S.T." blueprint — what matters is that the
// client can no longer dictate what text is actually sent to Groq under
// this app's key and quota.)
function buildCoachPrompt(params) {
  if (!isPlainObjectWithOnlyKeys(params, ALLOWED_COACH_PARAM_KEYS)) return null;
  const { companionId, stage1Type, stage2Type, stage3Type } = params;
  if (typeof companionId !== "string" || !Object.prototype.hasOwnProperty.call(COMPANION_PERSONAS, companionId)) return null;
  if (!STAGE1_CYCLE.includes(stage1Type)) return null;
  if (!STAGE2_CYCLE.includes(stage2Type)) return null;
  if (!STAGE3_CYCLE.includes(stage3Type)) return null;
  return buildCoachSystemPrompt(companionId, stage1Type, stage2Type, stage3Type);
}

// The five non-coach prompts take no params at all — reject anything
// other than "absent" (params === undefined) rather than silently
// ignoring an unexpected params object.
function fixedPrompt(promptText) {
  return (params) => (params === undefined ? promptText : null);
}

// "Create a targeted passage" from a report: the only other parameterized
// prompt besides "coach", validated the same way -- an explicit enum
// allow-list, null on anything else so the handler rejects it with a 400.
function buildPassageStarterPrompt(params) {
  if (!isPlainObjectWithOnlyKeys(params, ALLOWED_PASSAGE_STARTER_PARAM_KEYS)) return null;
  const { clueType } = params;
  if (!CLUE_TYPES.includes(clueType)) return null;
  return PASSAGE_STARTER_SYSTEM_PROMPT(clueType);
}

const PROMPT_BUILDERS = {
  coach: buildCoachPrompt,
  transfer_test: fixedPrompt(TRANSFER_TEST_SYSTEM_PROMPT),
  comprehension: fixedPrompt(COMPREHENSION_SYSTEM_PROMPT),
  single_word_regen: fixedPrompt(SINGLE_WORD_REGEN_PROMPT),
  level_maker: fixedPrompt(LEVEL_MAKER_SYSTEM_PROMPT(SESSION_WORD_COUNT)),
  passage_starter: buildPassageStarterPrompt,
  diagnostic: fixedPrompt(DIAGNOSTIC_SYSTEM_PROMPT),
};

// Decided by promptId now rather than sniffing prompt text — App.jsx also
// requests a taller max_tokens for this call, but the server decides the
// real ceiling either way.
function isDiagnosticPrompt(promptId) {
  return promptId === "diagnostic";
}

// Best-effort per-instance rate limit. Serverless instances are short-lived
// and not shared, so this doesn't guarantee a global cap, but it stops a
// single abusive client from hammering a warm instance. Vercel's Firewall
// rate-limit rule (configured in the dashboard, see README) and Groq's own
// account-wide limits are the real backstops; this is a cheap first layer
// against obvious abuse, not a precise model of Groq's shared token budget.
//
// Set to match Groq's actual stated free-tier RPM ceiling (no billing
// linked — verify your own live numbers at console.groq.com/docs/rate-
// limits, they can differ by account and model), the same "match the real
// number, don't try to be clever about a sub-limit" approach used for the
// Gemini version. An earlier attempt tried to preempt Groq's *token*-per-
// minute ceiling instead by estimating a smaller calls/minute figure —
// confirmed live to be too tight, tripping this during normal
// single-student play, not abuse. A higher value than the real ceiling
// would be pointless: Groq's own limit would reject the request first
// regardless, just with a raw upstream error instead of our own clearer
// message — exactly the outcome to avoid, so this matches their number
// directly rather than a hand-estimated fraction of it. Still 30 for
// openai/gpt-oss-20b (same as the old llama-3.1-8b-instant RPM), but its
// RPD and TPD ceilings are both considerably tighter — see
// DAILY_QUOTA_PER_CODE in _shared.js.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 30;
const checkRateLimit = createRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);

// Per-access-code daily quota, keyed by the label embedded in the token
// (see _authHandler.js / ACCESS_CODES), not by IP. Same best-effort,
// per-instance caveat as the rate limiter above. DAILY_QUOTA_PER_CODE
// itself lives in _shared.js since _authHandler.js needs it too.
const quotaLog = new Map();

// Increments and returns this access code's usage for today. Included in
// every response from this point on so the frontend can show a live "X
// of Y used today" indicator — there's no separate read-only endpoint
// for this because Vercel serverless functions don't share memory across
// different route files, so a standalone /api/quota check would almost
// always read a different, likely-empty counter instead of this one.
function getQuotaStatus(label) {
  const day = new Date().toISOString().slice(0, 10);
  pruneIfLarge(quotaLog, 5000, (e) => e.day !== day);
  const entry = quotaLog.get(label);
  const used = !entry || entry.day !== day ? 1 : entry.count + 1;
  quotaLog.set(label, { day, count: used });
  return { used, limit: DAILY_QUOTA_PER_CODE, remaining: Math.max(0, DAILY_QUOTA_PER_CODE - used), exceeded: used > DAILY_QUOTA_PER_CODE };
}

// Read-only counterpart to getQuotaStatus: reports what today's usage
// *would* be without incrementing anything, so the ceiling can be checked
// (and an already-exhausted code correctly rejected) before we know a
// Groq call is actually about to be attempted, without prematurely
// charging for one.
function getQuotaPreview(label) {
  const day = new Date().toISOString().slice(0, 10);
  const entry = quotaLog.get(label);
  const used = !entry || entry.day !== day ? 0 : entry.count;
  return { used, limit: DAILY_QUOTA_PER_CODE, remaining: Math.max(0, DAILY_QUOTA_PER_CODE - used), exceeded: used >= DAILY_QUOTA_PER_CODE };
}

function validateBody(body) {
  if (!isPlainObjectWithOnlyKeys(body, ALLOWED_BODY_KEYS)) return "Missing or unexpected fields in request body";
  if (body.model !== ALLOWED_MODEL) return "Unsupported model";
  if (typeof body.promptId !== "string" || !Object.prototype.hasOwnProperty.call(PROMPT_BUILDERS, body.promptId)) {
    return "Invalid promptId";
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return "Invalid messages";
  }
  for (const m of body.messages) {
    if (!isPlainObjectWithOnlyKeys(m, ALLOWED_MESSAGE_KEYS)) return "Unexpected fields in message";
    if (m.role !== "user" && m.role !== "assistant") return "Invalid message role";
    if (typeof m.content !== "string" || m.content.length > MAX_MESSAGE_CHARS) return "Invalid message content";
  }
  if (body.max_tokens !== undefined && (typeof body.max_tokens !== "number" || !Number.isFinite(body.max_tokens) || body.max_tokens <= 0)) {
    return "Invalid max_tokens";
  }
  return null;
}

// Groq's chat completions API is OpenAI-compatible: role "user"/"assistant"
// plain-string messages, same as Anthropic's shape and what App.jsx already
// sends, so no per-message reshaping is needed here. The one difference is
// the system prompt: Groq takes it as a "system"-role message prepended to
// the array, not a separate top-level field like Gemini's systemInstruction
// or Anthropic's system param.
function toGroqMessages(system, messages) {
  return [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
}

// Reshape Groq's OpenAI-compatible response into the { content: [{ type,
// text }] } shape App.jsx's callClaude() already expects from Anthropic's
// API.
function toAnthropicShape(groqData) {
  const text = groqData?.choices?.[0]?.message?.content || "";
  return { content: [{ type: "text", text }] };
}

export default async function claudeHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isOriginAllowed(req)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(ip);
  if (rateLimit.limited) {
    // Unlike the daily-quota 429 below, this clears itself within
    // RATE_LIMIT_WINDOW_MS (60s) — worth the client auto-retrying rather
    // than making a student/teacher notice and click Retry manually.
    // retryAfterMs here is however long is actually left in THIS ip's
    // window, not the full 60s — a classroom sharing one IP can trip this
    // mid-window, and without a real number the client would otherwise
    // fall back to its own fixed 20s guess, which can undershoot and
    // dead-end the retry exactly like the Groq-upstream 429 case this same
    // mechanism exists to fix (see retryAfterMs handling further down).
    return res.status(429).json({ error: "Too many requests, please slow down", retryable: true, retryAfterMs: rateLimit.retryAfterMs });
  }

  const token = getBearerToken(req);
  const claims = verifyToken(token, process.env.AUTH_SECRET);
  if (!claims) {
    // See the matching comment in _studentAuthHandler.js — tokenInvalid is
    // what the client's re-auth-overlay logic keys off of (callClaude
    // itself just checks response.status === 401, since this is the only
    // 401 this particular endpoint ever returns, but the field is added
    // here too for consistency across every handler).
    return res.status(401).json({ error: "Missing or expired access token", tokenInvalid: true });
  }

  // Validate the body before spending quota, so a malformed request (or a
  // client bug retrying on failure) can't burn a class's daily budget
  // without ever reaching Groq.
  const validationError = validateBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  // Build the real system prompt server-side from the promptId + params
  // the client sent — see PROMPT_BUILDERS above. A null result means
  // params didn't pass that promptId's allow-list (e.g. an unknown
  // companionId or stage type for "coach").
  const systemPrompt = PROMPT_BUILDERS[req.body.promptId](req.body.params);
  if (typeof systemPrompt !== "string") {
    return res.status(400).json({ error: "Invalid params" });
  }

  // Quota is a count of *attempted* Groq calls, so it must not be charged
  // until we actually know a call is about to be attempted with a valid
  // key. Checking the quota ceiling itself still has to come before that,
  // though, since checking it doesn't consume anything (getPreviewQuota
  // vs getQuotaStatus's charge) — otherwise a request that's already over
  // quota could sneak past by hitting the missing-key/network-error path.
  const preview = getQuotaPreview(claims.label);
  if (preview.exceeded) {
    return res.status(429).json({ error: "Daily quota reached for this access code, please try again tomorrow", quota: preview });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "Server is missing GROQ_API_KEY", quota: preview });
  }

  // Only charge the day's quota once we're actually about to spend a Groq
  // call, immediately before the fetch — a misconfigured key (caught
  // above) or a network failure (caught below) must not burn quota for a
  // call that never completed.
  const quota = getQuotaStatus(claims.label);

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: toGroqMessages(systemPrompt, req.body.messages),
        max_tokens: Math.min(
          req.body.max_tokens || MAX_TOKENS_CAP,
          isDiagnosticPrompt(req.body.promptId) ? DIAGNOSTIC_MAX_TOKENS_CAP : MAX_TOKENS_CAP
        ),
        ...REASONING_PARAMS,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      // Groq's own 429 (its free-tier per-minute request/token ceiling,
      // distinct from our own daily-quota 429 above) is short-lived —
      // its own error message typically includes a "try again in Ns"
      // window of single-digit-to-tens of seconds — so it's worth the
      // client auto-retrying rather than surfacing a dead end.
      const retryable = response.status === 429;
      // The exact wait Groq actually needs varies a lot by how close to
      // the ceiling the account is (seen live: anywhere from a couple
      // seconds up to 20+), and the client's own fixed retry delay is
      // just a guess for when this isn't available — passing the real
      // number through lets the client wait exactly as long as told
      // instead of sometimes retrying too early and failing again. Prefer
      // the standard Retry-After header (seconds) when Groq sends one;
      // otherwise fall back to parsing the "try again in Ns" the error
      // message already contains (confirmed present live, e.g. "Please
      // try again in 23.1225s").
      let retryAfterMs = null;
      if (retryable) {
        const headerSeconds = Number(response.headers.get("retry-after"));
        if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
          retryAfterMs = Math.ceil(headerSeconds * 1000);
        } else {
          const match = /try again in ([\d.]+)s/i.exec(data?.error?.message || "");
          if (match) retryAfterMs = Math.ceil(parseFloat(match[1]) * 1000);
        }
      }
      return res.status(response.status).json({
        error: data?.error?.message || "Upstream error",
        quota,
        ...(retryable ? { retryable: true } : {}),
        ...(retryAfterMs ? { retryAfterMs } : {}),
      });
    }
    return res.status(200).json({ ...toAnthropicShape(data), quota });
  } catch (err) {
    return res.status(502).json({ error: "Upstream request failed", quota });
  }
}
