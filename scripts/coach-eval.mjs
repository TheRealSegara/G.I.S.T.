// Manual regression check for the AI coach's response quality — run this
// by hand occasionally (not part of `npm run build` or any CI step: there's
// no test runner in this repo, and live-model calls are inherently
// non-deterministic, so this is a periodic health check, not a gate).
//
// Plays a few real multi-turn coaching exchanges against the actual Groq
// endpoint the app itself calls, and asserts the same content-level
// invariants added to `validateCoachResponse` in src/App.jsx: no MCQ option
// is the target word itself, word_bank/letter_connect tiles are exactly the
// target word's own letters, and tap_select/reverse_clue options are real
// words from the sentence, never hallucinated.
//
// NOTE: the validation logic below is a standalone copy of the same
// checks in src/App.jsx's validateCoachResponse (that file is JSX, not
// something a plain Node script can import directly) — if those checks
// change, update this file to match by hand. The prompt-building itself
// is imported from shared/prompts.js, the same module api/_claudeHandler.js
// uses, so this eval always tests the real, currently-shipping prompt.
//
// Usage: GROQ_API_KEY=... node scripts/coach-eval.mjs [runsPerScenario]

import { buildCoachSystemPrompt } from "../shared/prompts.js";

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const RUNS_PER_SCENARIO = Number(process.argv[2]) || 3;

if (!process.env.GROQ_API_KEY) {
  console.error("Missing GROQ_API_KEY in the environment. Set it and re-run:\n  GROQ_API_KEY=... node scripts/coach-eval.mjs");
  process.exit(1);
}

// --- Validation helpers (copy of the ones in src/App.jsx) ---

function stripInflection(s) {
  const w = String(s).toLowerCase().trim();
  return w.replace(/ies$/, "y").replace(/(es|ed|ing|ly|est|er|s)$/, "");
}
function isTargetWordMatch(candidate, targetWord) {
  if (!candidate || !targetWord) return false;
  const a = String(candidate).toLowerCase().trim();
  const b = String(targetWord).toLowerCase().trim();
  if (!a || !b) return false;
  return a === b || stripInflection(a) === stripInflection(b);
}
function tilesMatchWord(tiles, targetWord) {
  if (!Array.isArray(tiles) || !targetWord) return false;
  const tileLetters = tiles.map((t) => String(t).toLowerCase().trim()).filter(Boolean).sort().join("");
  const wordLetters = String(targetWord).toLowerCase().replace(/[^a-z]/g, "").split("").sort().join("");
  return !!wordLetters && tileLetters === wordLetters;
}
function stripPunctForCompare(s) {
  return String(s).toLowerCase().replace(/[.,!?;:"'()]/g, "").trim();
}
function optionInSentence(option, sentence) {
  const cleanOption = stripPunctForCompare(option);
  if (!cleanOption) return false;
  const sentenceWords = stripPunctForCompare(sentence).split(/\s+/);
  return sentenceWords.includes(cleanOption);
}

// Returns a list of violation strings (empty = clean).
function checkInvariants(parsed, targetWord) {
  const violations = [];
  if (parsed.input_type === "mcq" && Array.isArray(parsed.options)) {
    if (parsed.options.some((opt) => isTargetWordMatch(opt, targetWord))) {
      violations.push(`mcq options include the target word itself: ${JSON.stringify(parsed.options)}`);
    }
  }
  if ((parsed.input_type === "word_bank" || parsed.input_type === "letter_connect") && !tilesMatchWord(parsed.word_tiles, targetWord)) {
    violations.push(`word_tiles don't match "${targetWord}": ${JSON.stringify(parsed.word_tiles)}`);
  }
  if ((parsed.input_type === "tap_select" || parsed.input_type === "reverse_clue") && Array.isArray(parsed.options)) {
    const bad = parsed.options.filter((opt) => !optionInSentence(opt, parsed.display_sentence));
    if (bad.length) violations.push(`option(s) not actually in display_sentence: ${JSON.stringify(bad)} (sentence: "${parsed.display_sentence}")`);
  }
  return violations;
}

async function callGroq(system, messages) {
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 1000,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Groq request failed (${response.status})`);
  const text = data?.choices?.[0]?.message?.content || "";
  return JSON.parse(text);
}

// --- Scenarios: mirrors a real playthrough — Stage 1 mcq, Stage 2
// word_bank, Stage 3 tap_select — submitting the correct answer each turn
// (with the same [FACT: ...] note the real app injects) to advance. ---

const SCENARIOS = [
  { word: "resilient", passage: "After the storm, the old village was resilient and quickly rebuilt its homes." },
  { word: "camouflage", passage: "The gecko used its camouflage to blend perfectly into the green leaves." },
];

async function runScenario(scenario, runIndex) {
  const violations = [];
  const system = buildCoachSystemPrompt("parrot", "mcq", "word_bank", "tap_select");
  const openingMsg = `Passage: "${scenario.passage}"\n\nStart coaching for the target word "${scenario.word}". Begin at Stage 1.`;
  const history = [{ role: "user", content: openingMsg }];

  let parsed;
  try {
    parsed = await callGroq(system, history);
  } catch (e) {
    return [`[${scenario.word} run ${runIndex}] Stage 1 call failed: ${e.message}`];
  }
  violations.push(...checkInvariants(parsed, scenario.word).map((v) => `[${scenario.word} run ${runIndex}, stage 1] ${v}`));
  history.push({ role: "assistant", content: JSON.stringify(parsed) });

  // Submit the correct MCQ answer, exactly like submitAnswer() does.
  const mcqAnswer = parsed.correct_answer || (parsed.options && parsed.options[0]) || "";
  history.push({ role: "user", content: `${mcqAnswer}\n[FACT: this answer is CORRECT. Trust this, don't re-judge correctness yourself this turn.]` });
  try {
    parsed = await callGroq(system, history);
  } catch (e) {
    violations.push(`[${scenario.word} run ${runIndex}] Stage 2 call failed: ${e.message}`);
    return violations;
  }
  violations.push(...checkInvariants(parsed, scenario.word).map((v) => `[${scenario.word} run ${runIndex}, stage 2] ${v}`));
  history.push({ role: "assistant", content: JSON.stringify(parsed) });

  // Submit the target word itself as the word_bank/letter_connect answer.
  history.push({ role: "user", content: `${scenario.word}\n[FACT: this answer is CORRECT. Trust this, don't re-judge correctness yourself this turn.]` });
  try {
    parsed = await callGroq(system, history);
  } catch (e) {
    violations.push(`[${scenario.word} run ${runIndex}] Stage 3 call failed: ${e.message}`);
    return violations;
  }
  violations.push(...checkInvariants(parsed, scenario.word).map((v) => `[${scenario.word} run ${runIndex}, stage 3] ${v}`));

  return violations;
}

(async () => {
  console.log(`Running ${SCENARIOS.length} scenario(s) x ${RUNS_PER_SCENARIO} run(s) against ${GROQ_MODEL}...\n`);
  let totalViolations = [];
  for (const scenario of SCENARIOS) {
    for (let i = 1; i <= RUNS_PER_SCENARIO; i++) {
      const violations = await runScenario(scenario, i);
      if (violations.length) {
        console.log(`✗ ${scenario.word} run ${i}: ${violations.length} violation(s)`);
        violations.forEach((v) => console.log(`   - ${v}`));
      } else {
        console.log(`✓ ${scenario.word} run ${i}: clean`);
      }
      totalViolations = totalViolations.concat(violations);
    }
  }
  console.log(`\n${totalViolations.length === 0 ? "All clean." : `${totalViolations.length} total violation(s) found.`}`);
  process.exit(totalViolations.length > 0 ? 1 : 0);
})();
