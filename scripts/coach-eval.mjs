// Manual regression check for the AI coach's response quality — run this
// by hand occasionally (not part of `npm run build` or any CI step: there's
// no test runner in this repo, and live-model calls are inherently
// non-deterministic, so this is a periodic health check, not a gate).
//
// Plays a few real multi-turn coaching exchanges against the actual Groq
// endpoint the app itself calls, and asserts the same content-level
// invariants added to `validateCoachResponse` in src/App.jsx: no MCQ option
// is the target word itself, word_bank/letter_connect tiles are exactly the
// target word's own letters, tap_select is an odd-one-out among exactly 4
// single words that always includes the target word (but never as the
// answer), and reverse_clue options are real OTHER sentences copied
// verbatim from the passage (never the target word's own sentence, never
// invented).
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
function splitIntoSentences(text) {
  return (String(text).match(/[^.!?]+[.!?]+/g) || [text]).map((s) => s.trim()).filter(Boolean);
}
function normalizeSentenceForCompare(s) {
  return stripPunctForCompare(s).replace(/\s+/g, " ").trim();
}
function sentenceInPassage(candidate, passageText) {
  const target = normalizeSentenceForCompare(candidate);
  if (!target || !passageText) return false;
  return splitIntoSentences(passageText).some((s) => normalizeSentenceForCompare(s) === target);
}

const NOUN_DETERMINERS = "the|a|an|his|her|its|their|this|that|some";
const NOUN_FOLLOWERS = "was|is|were|are|felt|seemed|looked|became|grew|helps|help|hurts|has|had";
// Mirrors wordUsedAsNounInText/starterForcesNounSlot in src/App.jsx --
// Stage 4's sentence_starter embeds the target word directly, so a starter
// like "The reluctant was very" forces an adjective into a noun-subject
// slot, which is nonsensical even though every other shape check passes.
// Requires the word to END the noun phrase (a boundary or finite verb
// right after it), not just follow a determiner -- "an enormous orang
// utan" also has a determiner right before "enormous", but "enormous" is
// a modifier there, not the head noun.
function wordUsedAsNounInText(text, targetWord) {
  const w = String(targetWord || "").toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!w || !text) return false;
  return new RegExp(`\\b(${NOUN_DETERMINERS})\\s+${w}\\b(?=\\s*(?:[.,!?;:]|$|(?:${NOUN_FOLLOWERS})\\b))`, "i").test(
    String(text).toLowerCase()
  );
}
function starterForcesNounSlot(starter, targetWord) {
  const w = String(targetWord || "").toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!w) return false;
  return new RegExp(`^(${NOUN_DETERMINERS})\\s+${w}\\s+(was|is|were|are|felt|seemed|looked|became|grew)\\b`, "i").test(
    String(starter || "").trim().toLowerCase()
  );
}
function getSentenceContaining(text, word) {
  const sentences = splitIntoSentences(text);
  const found = sentences.find((s) => s.toLowerCase().includes(String(word).toLowerCase()));
  return found || sentences[0] || text;
}
function wordCount(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}
function messageSentences(message) {
  return String(message).split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
}
const HARD_CONNECTOR_RE = /\b(although|nevertheless|consequently)\b/i;
const MESSAGE_MAX_SENTENCES = 3;
const MESSAGE_MAX_WORDS_PER_SENTENCE = 12;
const MCQ_OPTION_MAX_WORDS = 5;

// Returns a list of violation strings (empty = clean).
function checkInvariants(parsed, targetWord, passageText) {
  const violations = [];
  if (parsed.input_type === "mcq" && Array.isArray(parsed.options)) {
    if (parsed.options.some((opt) => isTargetWordMatch(opt, targetWord))) {
      violations.push(`mcq options include the target word itself: ${JSON.stringify(parsed.options)}`);
    }
    if (parsed.options.some((opt) => wordCount(opt) > MCQ_OPTION_MAX_WORDS)) {
      violations.push(`mcq option over ${MCQ_OPTION_MAX_WORDS} words: ${JSON.stringify(parsed.options)}`);
    }
  }
  if ((parsed.input_type === "word_bank" || parsed.input_type === "letter_connect") && !tilesMatchWord(parsed.word_tiles, targetWord)) {
    violations.push(`word_tiles don't match "${targetWord}": ${JSON.stringify(parsed.word_tiles)}`);
  }
  // tap_select is now an odd-one-out among exactly 4 single words -- the
  // target word must be one of the 3 that "belong" (never the answer
  // itself, or recognizing the header word would trivially solve it again).
  if (parsed.input_type === "tap_select" && Array.isArray(parsed.options)) {
    if (parsed.options.length !== 4) {
      violations.push(`tap_select has ${parsed.options.length} options, expected exactly 4: ${JSON.stringify(parsed.options)}`);
    }
    const notSingleWords = parsed.options.filter((opt) => !/^\S+$/.test(String(opt).trim()));
    if (notSingleWords.length) violations.push(`tap_select option(s) aren't single words: ${JSON.stringify(notSingleWords)}`);
    if (!parsed.options.some((opt) => isTargetWordMatch(opt, targetWord))) {
      violations.push(`tap_select options don't include the target word "${targetWord}": ${JSON.stringify(parsed.options)}`);
    }
    if (isTargetWordMatch(parsed.correct_answer, targetWord)) {
      violations.push(`tap_select's correct_answer is the target word itself (the header gives it away): "${parsed.correct_answer}"`);
    }
  }
  // reverse_clue now asks the student to pick a whole OTHER sentence from
  // the passage explaining the target word, not a single word from its
  // own sentence -- mirrors the sentence-level checks added to
  // validateCoachResponse in src/App.jsx.
  if (parsed.input_type === "reverse_clue" && Array.isArray(parsed.options)) {
    if (parsed.options.length !== 3) {
      violations.push(`reverse_clue has ${parsed.options.length} options, expected exactly 3: ${JSON.stringify(parsed.options)}`);
    }
    if (passageText) {
      const bad = parsed.options.filter((opt) => !sentenceInPassage(opt, passageText));
      if (bad.length) violations.push(`reverse_clue option(s) aren't real sentences copied from the passage: ${JSON.stringify(bad)}`);
      const ownSentence = normalizeSentenceForCompare(getSentenceContaining(passageText, targetWord));
      if (parsed.options.some((opt) => normalizeSentenceForCompare(opt) === ownSentence)) {
        violations.push(`reverse_clue offered the target word's own sentence as an option (circular): ${JSON.stringify(parsed.options)}`);
      }
    }
  }
  if (parsed.input_type === "text" && parsed.stage === 4 && typeof parsed.sentence_starter === "string" && parsed.sentence_starter.trim()) {
    const referenceText = (passageText && getSentenceContaining(passageText, targetWord)) || parsed.display_sentence;
    if (starterForcesNounSlot(parsed.sentence_starter, targetWord) && !wordUsedAsNounInText(referenceText, targetWord)) {
      violations.push(`Stage 4 sentence_starter forces "${targetWord}" into a noun-subject slot it doesn't fit: "${parsed.sentence_starter}"`);
    }
  }
  if (parsed.input_type === "true_false") {
    if (!Array.isArray(parsed.options) || parsed.options.length !== 2) {
      violations.push(`true_false options should be exactly ["True","False"]: ${JSON.stringify(parsed.options)}`);
    }
    if (/\?\s*$/.test(String(parsed.message).trim())) {
      violations.push(`true_false message is phrased as a question, not a statement: "${parsed.message}"`);
    }
  }
  if (HARD_CONNECTOR_RE.test(parsed.message)) {
    violations.push(`message uses a banned hard connector: "${parsed.message}"`);
  }
  const sentences = messageSentences(parsed.message);
  if (sentences.length > MESSAGE_MAX_SENTENCES) {
    violations.push(`message has ${sentences.length} sentences, max ${MESSAGE_MAX_SENTENCES}: "${parsed.message}"`);
  }
  const longSentence = sentences.find((s) => wordCount(s) > MESSAGE_MAX_WORDS_PER_SENTENCE);
  if (longSentence) {
    violations.push(`message sentence over ${MESSAGE_MAX_WORDS_PER_SENTENCE} words: "${longSentence}"`);
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

// --- Scenarios: mirrors a real playthrough through Stages 1-3, submitting
// the correct answer each turn (with the same [FACT: ...] note the real
// app injects) to advance. Runs each scenario against two different
// input_type combos so both cycle branches actually get exercised —
// mcq/word_bank/tap_select alone would never have caught the true_false
// question-phrasing or reverse_clue Stage-3-framing bugs found in the
// coach quality audit, since neither type appears in that combo. ---

// Multi-sentence passages, not single sentences -- reverse_clue's options
// are now OTHER sentences from the passage, so a one-sentence passage
// would leave the model with no real sentence to offer at all.
const SCENARIOS = [
  {
    word: "resilient",
    passage: "After the storm, the old village was resilient and quickly rebuilt its homes. Fallen trees were cleared within days, and neighbors helped each other repair broken roofs. Nobody complained or gave up, even when the work was hard. By the next season, the village looked almost as good as before.",
  },
  {
    word: "camouflage",
    passage: "The gecko used its camouflage to blend perfectly into the green leaves. A hungry bird flew right past without ever noticing it was there. Its skin had slowly changed color to match the plant it rested on. Only a very close look would reveal it was hiding at all.",
  },
];

const TYPE_COMBOS = [
  { stage1: "mcq", stage2: "word_bank", stage3: "tap_select" },
  { stage1: "true_false", stage2: "letter_connect", stage3: "reverse_clue" },
];

async function runScenario(scenario, typeCombo, runIndex) {
  const violations = [];
  const system = buildCoachSystemPrompt("parrot", typeCombo.stage1, typeCombo.stage2, typeCombo.stage3);
  const openingMsg = `Passage: "${scenario.passage}"\n\nStart coaching for the target word "${scenario.word}". Begin at Stage 1.`;
  const history = [{ role: "user", content: openingMsg }];
  const label = `${scenario.word} [${typeCombo.stage1}/${typeCombo.stage2}/${typeCombo.stage3}] run ${runIndex}`;

  for (let stage = 1; stage <= 3; stage++) {
    let parsed;
    try {
      parsed = await callGroq(system, history);
    } catch (e) {
      violations.push(`[${label}] Stage ${stage} call failed: ${e.message}`);
      return violations;
    }
    violations.push(...checkInvariants(parsed, scenario.word, scenario.passage).map((v) => `[${label}, stage ${stage}] ${v}`));
    if (stage === 3) break;
    history.push({ role: "assistant", content: JSON.stringify(parsed) });
    // Deterministic types (mcq/true_false/tap_select/reverse_clue) have a
    // fixed correct_answer; word_bank/letter_connect check against the
    // target word itself instead — same distinction submitAnswer() makes
    // in the real app via getCorrectAnswerForCurrent().
    const answer = typeof parsed.correct_answer === "string" ? parsed.correct_answer : scenario.word;
    history.push({ role: "user", content: `${answer}\n[FACT: this answer is CORRECT. Trust this, don't re-judge correctness yourself this turn.]` });
  }
  return violations;
}

(async () => {
  console.log(`Running ${SCENARIOS.length} scenario(s) x ${TYPE_COMBOS.length} type combo(s) x ${RUNS_PER_SCENARIO} run(s) against ${GROQ_MODEL}...\n`);
  let totalViolations = [];
  for (const scenario of SCENARIOS) {
    for (const typeCombo of TYPE_COMBOS) {
      for (let i = 1; i <= RUNS_PER_SCENARIO; i++) {
        const label = `${scenario.word} [${typeCombo.stage1}/${typeCombo.stage2}/${typeCombo.stage3}] run ${i}`;
        const violations = await runScenario(scenario, typeCombo, i);
        if (violations.length) {
          console.log(`✗ ${label}: ${violations.length} violation(s)`);
          violations.forEach((v) => console.log(`   - ${v}`));
        } else {
          console.log(`✓ ${label}: clean`);
        }
        totalViolations = totalViolations.concat(violations);
      }
    }
  }
  console.log(`\n${totalViolations.length === 0 ? "All clean." : `${totalViolations.length} total violation(s) found.`}`);
  process.exit(totalViolations.length > 0 ? 1 : 0);
})();
