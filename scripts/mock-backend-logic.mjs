// Shared, environment-agnostic mock backend logic for the two offline demo
// tools (scripts/local-demo-server.mjs for Node, scripts/build-offline-demo.mjs
// for the single-file browser build). Written as one canonical module so the
// two never drift apart -- local-demo-server.mjs imports this directly;
// build-offline-demo.mjs reads this file's source as text, strips the
// trailing `export` line, and inlines the rest into the browser bundle (see
// that script for why: no bundler, just string concatenation).
//
// Pure logic only: no Node built-ins (fs, crypto, etc.) and no browser-only
// globals (window, fetch) -- both the Express route handlers and the
// browser fetch-interceptor call these same functions with plain
// JSON-shaped arguments and expect plain JSON-shaped returns.

/* ---------------- Word content: the app's 4 real built-in passages (20 words) ---------------- */
// Each has a fixed, passage-specific hint (references actual passage
// content, e.g. "the little brother"), so these are NOT run through the
// generic sentence-extraction fallback below -- they're already grounded.
const CORE_WORDS = {
  reluctant: { meaning: "Unwilling; hesitant", distractors: ["Very excited", "Completely confused", "Extremely brave"], hint: "Think about how the little brother acted before seeing the orang utan." },
  enormous: { meaning: "Very big; huge", distractors: ["Very small", "Very fast", "Very colourful"], hint: "The passage compares its size to something else nearby." },
  curious: { meaning: "Eager to know more", distractors: ["Feeling sleepy", "Feeling angry", "Feeling bored"], hint: "Think about why he kept asking questions." },
  damp: { meaning: "Slightly wet", distractors: ["Very hot", "Completely dry", "Very cold"], hint: "The fur felt this way because it had just rained." },
  gentle: { meaning: "Kind and calm", distractors: ["Loud and rough", "Fast and messy", "Shy and quiet"], hint: "The ranger contrasts how they look with how they actually behave." },
  bustling: { meaning: "Busy and lively", distractors: ["Quiet and empty", "Slow and sleepy", "Dark and scary"], hint: "Think about the stalls and children running everywhere." },
  delighted: { meaning: "Very pleased", distractors: ["Very worried", "Very confused", "Very tired"], hint: "Think about grandmother's big smile." },
  fragrant: { meaning: "Smelling sweet", distractors: ["Tasting sour", "Feeling rough", "Sounding loud"], hint: "The passage describes the pandan leaves' smell." },
  exhausted: { meaning: "Extremely tired", distractors: ["Extremely happy", "Extremely hungry", "Extremely proud"], hint: "Think about a full day of cooking and welcoming guests." },
  generous: { meaning: "Willing to share freely", distractors: ["Unwilling to share", "Quick to argue", "Slow to answer"], hint: "Think about how the neighbours treat anyone who walks by." },
  brave: { meaning: "Not afraid", distractors: ["Very shy", "Very silly", "Very sleepy"], hint: "Mei says spiders look scary, but are actually this." },
  camouflage: { meaning: "Colouring that helps hide", distractors: ["A loud sound", "A fast movement", "A sweet smell"], hint: "Think about how a gecko can change color." },
  timid: { meaning: "Shy and easily scared", distractors: ["Bold and loud", "Playful and silly", "Angry and mean"], hint: "Think about what the cat does when guests come." },
  clever: { meaning: "Quick to learn and understand", distractors: ["Slow to learn", "Hard to see", "Easy to scare"], hint: "Think about how the dog can open doors by itself." },
  playful: { meaning: "Full of fun", distractors: ["Full of worry", "Full of anger", "Full of silence"], hint: "Think about the rabbit jumping and running all day." },
  invented: { meaning: "Created something new", distractors: ["Broke something old", "Found something lost", "Copied something else"], hint: "Think about what the scientist did to make the robot." },
  powerful: { meaning: "Very strong", distractors: ["Very weak", "Very quiet", "Very slow"], hint: "Think about the robot lifting heavy boxes easily." },
  careful: { meaning: "Paying close attention", distractors: ["Not paying attention", "Moving very fast", "Making a lot of noise"], hint: "Think about how the robot never drops anything." },
  amazing: { meaning: "Causing great wonder", distractors: ["Causing boredom", "Causing confusion", "Causing worry"], hint: "Think about how everyone reacted to the robot dancing and singing." },
  tiny: { meaning: "Very small", distractors: ["Very large", "Very loud", "Very old"], hint: "The passage compares the computer's size to your hand." },
};

// tap_select's odd-one-out (Stage 3): 2 real synonyms that belong with the
// target word, plus 1 word that clearly doesn't (an antonym or unrelated
// quality) -- that odd word is the correct_answer. The target word itself
// is always added as a 4th, 3rd-"belonging" option by the caller below, so
// this table only needs to hold the other 3.
const ODD_ONE_OUT = {
  reluctant: { belongs: ["hesitant", "unwilling"], odd: "eager" },
  enormous: { belongs: ["huge", "gigantic"], odd: "tiny" },
  curious: { belongs: ["inquisitive", "interested"], odd: "bored" },
  damp: { belongs: ["moist", "wet"], odd: "dry" },
  gentle: { belongs: ["kind", "calm"], odd: "rough" },
  bustling: { belongs: ["busy", "lively"], odd: "quiet" },
  delighted: { belongs: ["pleased", "happy"], odd: "upset" },
  fragrant: { belongs: ["sweet", "perfumed"], odd: "smelly" },
  exhausted: { belongs: ["tired", "weary"], odd: "energetic" },
  generous: { belongs: ["giving", "kind"], odd: "selfish" },
  brave: { belongs: ["fearless", "bold"], odd: "scared" },
  camouflage: { belongs: ["disguise", "cover"], odd: "spotlight" },
  timid: { belongs: ["shy", "nervous"], odd: "confident" },
  clever: { belongs: ["smart", "bright"], odd: "foolish" },
  playful: { belongs: ["fun", "silly"], odd: "serious" },
  invented: { belongs: ["made", "built"], odd: "destroyed" },
  powerful: { belongs: ["strong", "mighty"], odd: "weak" },
  careful: { belongs: ["cautious", "attentive"], odd: "careless" },
  amazing: { belongs: ["wonderful", "incredible"], odd: "boring" },
  tiny: { belongs: ["small", "little"], odd: "huge" },
};
// Generic fallback for a word not in ODD_ONE_OUT (an EXTENDED_WORDS entry
// or a Level Maker word) -- borrows a real curated group's "belongs" pair
// and "odd" word rather than inventing fake ones, same trade-off the MCQ
// fallback above already makes ("a self-consistent group, not a real
// relation for THIS word, but doesn't fail outright").
const ODD_ONE_OUT_KEYS = Object.keys(ODD_ONE_OUT);
function oddOneOutFor(word) {
  const curated = ODD_ONE_OUT[word.toLowerCase()];
  if (curated) return curated;
  return ODD_ONE_OUT[ODD_ONE_OUT_KEYS[Math.floor(Math.random() * ODD_ONE_OUT_KEYS.length)]];
}



// Extended dictionary -- common storybook-register words that a teacher's
// pasted passage (Level Maker) is likely to actually contain. No fixed
// "hint" here (there's no fixed passage to reference); instead the hint is
// built at runtime from the sentence the word genuinely appears in within
// whatever passage the teacher pasted, via getSentenceContaining() below,
// so it's still grounded in real content rather than generic filler.
const EXTENDED_WORDS = {
  ancient: { meaning: "Very old, from long ago", distractors: ["Brand new", "Medium-sized", "Recently painted"] },
  narrow: { meaning: "Not wide; thin", distractors: ["Very wide", "Very tall", "Very colourful"] },
  massive: { meaning: "Extremely large", distractors: ["Extremely small", "Extremely quiet", "Extremely old"] },
  glistening: { meaning: "Shining with a wet or bright light", distractors: ["Completely dark", "Rough to the touch", "Very quiet"] },
  peculiar: { meaning: "Strange or unusual", distractors: ["Completely normal", "Very boring", "Very expensive"] },
  vast: { meaning: "Extremely large in area", distractors: ["Extremely narrow", "Extremely short", "Extremely loud"] },
  weary: { meaning: "Very tired", distractors: ["Full of energy", "Very angry", "Very curious"] },
  cheerful: { meaning: "Happy and bright in mood", distractors: ["Sad and gloomy", "Angry and loud", "Bored and tired"] },
  mysterious: { meaning: "Difficult to explain; secretive", distractors: ["Completely obvious", "Very loud", "Extremely simple"] },
  stubborn: { meaning: "Refusing to change one's mind", distractors: ["Quick to agree", "Easily confused", "Very forgetful"] },
  graceful: { meaning: "Moving in a smooth, elegant way", distractors: ["Moving clumsily", "Moving very slowly", "Not moving at all"] },
  clumsy: { meaning: "Awkward in movement; likely to drop things", distractors: ["Very graceful", "Very careful", "Very quiet"] },
  eager: { meaning: "Very keen and enthusiastic", distractors: ["Very reluctant", "Very bored", "Very sleepy"] },
  anxious: { meaning: "Feeling worried or nervous", distractors: ["Feeling calm and relaxed", "Feeling proud", "Feeling sleepy"] },
  furious: { meaning: "Extremely angry", distractors: ["Extremely calm", "Extremely happy", "Extremely tired"] },
  gloomy: { meaning: "Dark and sad in mood or appearance", distractors: ["Bright and cheerful", "Loud and busy", "Fast and exciting"] },
  vivid: { meaning: "Very bright and clear", distractors: ["Very dull and faint", "Very quiet", "Very old"] },
  faint: { meaning: "Weak; barely noticeable", distractors: ["Extremely strong", "Extremely loud", "Extremely bright"] },
  sturdy: { meaning: "Strongly and solidly built", distractors: ["Easily broken", "Very light", "Very colourful"] },
  fragile: { meaning: "Easily broken or damaged", distractors: ["Very sturdy", "Very heavy", "Very ordinary"] },
  reckless: { meaning: "Acting without thinking of danger", distractors: ["Acting very cautiously", "Acting very slowly", "Acting very kindly"] },
  cautious: { meaning: "Careful to avoid danger or mistakes", distractors: ["Acting recklessly", "Acting angrily", "Acting playfully"] },
  humble: { meaning: "Not proud; modest", distractors: ["Very boastful", "Very shy", "Very stubborn"] },
  ordinary: { meaning: "Not special or unusual", distractors: ["Extraordinary and rare", "Extremely large", "Extremely old"] },
  extraordinary: { meaning: "Very unusual or remarkable", distractors: ["Completely ordinary", "Very small", "Very quiet"] },
  silent: { meaning: "Completely quiet", distractors: ["Extremely loud", "Very bright", "Very crowded"] },
  deserted: { meaning: "Empty; abandoned", distractors: ["Completely crowded", "Very colourful", "Very noisy"] },
  crowded: { meaning: "Full of people", distractors: ["Completely empty", "Very quiet", "Very tidy"] },
  spacious: { meaning: "Having a lot of space", distractors: ["Very cramped", "Very dark", "Very old"] },
  cramped: { meaning: "Having too little space", distractors: ["Very spacious", "Very bright", "Very quiet"] },
  drowsy: { meaning: "Feeling sleepy", distractors: ["Feeling wide awake", "Feeling angry", "Feeling curious"] },
  alert: { meaning: "Quick to notice things; watchful", distractors: ["Half asleep", "Very confused", "Very careless"] },
  miserable: { meaning: "Very unhappy", distractors: ["Very delighted", "Very proud", "Very calm"] },
  swift: { meaning: "Moving very fast", distractors: ["Moving very slowly", "Standing completely still", "Moving very quietly"] },
  sluggish: { meaning: "Slow-moving; lacking energy", distractors: ["Fast and energetic", "Loud and cheerful", "Careful and precise"] },
  vibrant: { meaning: "Full of energy and bright colour", distractors: ["Dull and faded", "Quiet and still", "Old and worn"] },
};

const WORDS = Object.assign({}, CORE_WORDS, EXTENDED_WORDS);
const KNOWN_WORDS = Object.keys(WORDS);

const COMPREHENSION_BY_PASSAGE = [
  { match: "Mei Ling", question: "Why was the little brother reluctant to walk into the forest at first?", options: ["He was scared and didn't want to go", "He was too tired to walk", "He didn't like his mother", "He wanted to go home"], correctAnswer: "He was scared and didn't want to go" },
  { match: "Aiman's village", question: "Why does Aiman's village have a festival?", options: ["To celebrate the harvest", "To welcome new students", "To open a new market", "To say goodbye to summer"], correctAnswer: "To celebrate the harvest" },
  { match: "Pet Show", question: "What is special about Ali's dog?", options: ["It can open doors by itself", "It can talk", "It can swim very fast", "It changes color"], correctAnswer: "It can open doors by itself" },
  { match: "robot show", question: "What can the robot do besides lifting heavy boxes?", options: ["Dance and sing songs", "Cook food", "Fly in the sky", "Read books aloud"], correctAnswer: "Dance and sing songs" },
];

/* ---------------- variety templates ---------------- */
// Generic wrapper phrasing, randomized each call, kept separate from the
// word-specific substantive content (the actual hint/meaning) so replaying
// the same word doesn't always show byte-identical text, without ever
// touching the part that has to stay accurate.
const INTRO_TEMPLATES = [
  function (word) { return "Let's figure out what \"" + word + "\" means here! Pick the best answer."; },
  function (word) { return "Time to work out \"" + word + "\"! Read carefully and pick what fits best."; },
  function (word) { return "New word alert: \"" + word + "\"! Let's see if you can work out what it means."; },
];
// Each wrapper deliberately ends its own lead-in on a full sentence
// break (never a dash/colon that would run on into the hint) -- the real
// frontend's validator caps every SENTENCE at 12 words, and several
// curated hints are already close to that on their own, so concatenating
// a lead-in onto the same sentence as the hint (as this used to do with
// an em dash) could push a perfectly fine hint over the limit.
const WRONG_WRAPPERS = [
  function (hint) { return "Not quite! " + hint; },
  function (hint) { return "Close, but not quite. " + hint; },
  function (hint) { return "Almost! " + hint; },
];
// Used when a correct answer advances the word to a harder stage (1-3),
// as opposed to FINAL_RESOLVED_TEMPLATES below, which is only for the
// word actually being done (succeeding at Stage 4 or 5).
const ADVANCE_TEMPLATES = [
  function (word) { return "Nice! Let's go a bit deeper with \"" + word + "\"."; },
  function (word) { return "Got it! Time for a trickier challenge with \"" + word + "\"."; },
  function (word) { return "Well done! Let's push a little further with \"" + word + "\"."; },
];
const FINAL_RESOLVED_TEMPLATES = [
  function (word) { return "Excellent! You've truly mastered \"" + word + "\"."; },
  function (word) { return "That's it, you really know \"" + word + "\" now!"; },
  function (word) { return "Amazing work, \"" + word + "\" is yours now!"; },
];
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Deterministic (letters only shuffled) tiles for word_bank/letter_connect
// -- exact letters of `word`, nothing added or dropped, matching
// tilesMatchWord's check in the real frontend's validator.
function shuffleLetters(word) {
  const letters = word.split("");
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = letters[i];
    letters[i] = letters[j];
    letters[j] = tmp;
  }
  return letters;
}

function findLiteralWord(text) {
  const m = /target word "([^"]+)"/.exec(text || "");
  return m ? m[1].toLowerCase() : null;
}

function pickDistinct(arr, n, exclude) {
  return arr.filter(function (w) { return w !== exclude; }).sort(function () { return Math.random() - 0.5; }).slice(0, n);
}

// The real frontend always sends the full passage text alongside the target
// word (see submitAnswer/startWord's opening message and the transfer-test
// call in src/App.jsx), so it's recoverable from the message history on
// every turn -- this lets the generic/extended-word fallbacks quote real
// passage content instead of inventing anything.
function extractPassageText(allMsgs) {
  const m =
    /Passage: "([\s\S]*?)"\n\nStart coaching/.exec(allMsgs) ||
    /Original passage: "([\s\S]*?)"\n\nTarget word/.exec(allMsgs) ||
    /Passage: "([\s\S]*?)"/.exec(allMsgs);
  return m ? m[1] : "";
}

function getSentenceContaining(text, word) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || (text ? [text] : []);
  const re = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
  for (let i = 0; i < sentences.length; i++) if (re.test(sentences[i])) return sentences[i];
  return text;
}

// Mirrors splitIntoSentences in src/App.jsx -- used by reverse_clue below
// to offer real OTHER sentences from the passage, not fabricated ones,
// since the real frontend's validator checks every option is a genuine
// substring of the actual passage text.
function splitIntoSentences(text) {
  return (text.match(/[^.!?]+[.!?]+/g) || (text ? [text] : [])).map(function (s) { return s.trim(); }).filter(Boolean);
}

// A handful of curated words genuinely ARE a noun or verb in their real
// passage sentence (unlike most CORE_WORDS, which are adjectives) --
// listed explicitly here since the text-based heuristic below can't
// reliably tell "use camouflage." (camouflage = the noun itself) apart
// from a case with no determiner nearby at all.
const STAGE4_NOUN_OR_VERB_WORDS = new Set(["camouflage", "aroma"]);

// Mirrors wordUsedAsNounInText in src/App.jsx -- Stage 4's sentence_starter
// below embeds the target word directly, so "The <word> was very" only
// makes sense when the passage actually uses the word as the HEAD of a
// noun phrase: immediately after a determiner AND immediately ending that
// phrase (followed by a clause boundary or a finite verb). Requiring both
// avoids misreading "an enormous orang utan" as "enormous" being a noun --
// it's a modifier there, not the head, even though a determiner sits
// right before it too. Most of CORE_WORDS are adjectives ("reluctant",
// "enormous", ...), so a fixed noun-shaped template produced the same
// nonsensical noun-subject slot the real coach's prompt now warns against.
function wordUsedAsNounInMock(text, word) {
  const w = String(word || "").toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (STAGE4_NOUN_OR_VERB_WORDS.has(String(word || "").toLowerCase().trim())) return true;
  if (!w || !text) return false;
  const followers = "was|is|were|are|felt|seemed|looked|became|grew|helps|help|hurts|has|had";
  return new RegExp(`\\b(the|a|an|his|her|its|their|this|that|some)\\s+${w}\\b(?=\\s*(?:[.,!?;:]|$|(?:${followers})\\b))`, "i").test(
    String(text).toLowerCase()
  );
}

const STOPWORDS_LIST = ["about", "after", "again", "their", "there", "these", "those", "which", "while", "would", "could", "should", "because", "before", "between", "through", "though", "where", "when", "what", "were", "being", "doing", "having", "other", "really", "still", "every", "never", "always", "something", "someone", "anything", "around", "across", "toward", "towards", "during", "without", "within", "under", "above", "below", "first", "second", "third", "little", "great", "large", "quite"];
const STOPWORDS = {};
STOPWORDS_LIST.forEach(function (w) { STOPWORDS[w] = true; });

// Real words (5+ letters, not a stopword) that literally appear in a pasted
// passage -- used so the Level Maker mock never picks a word the student
// can't actually tap in their own text.
function extractRealWords(text) {
  const seen = {};
  const out = [];
  const matches = text.match(/[A-Za-z]{5,}/g) || [];
  for (let i = 0; i < matches.length; i++) {
    const w = matches[i].toLowerCase();
    if (STOPWORDS[w] || seen[w]) continue;
    seen[w] = true;
    out.push(w);
  }
  return out;
}

// Builds a hint for a word that has curated meaning/distractors but no
// fixed passage-specific hint (the 30-word extended dictionary) -- grounds
// it in the real sentence from whatever passage the teacher pasted, rather
// than a generic "think about it" filler.
// Deliberately never quotes the actual sentence here -- it's already
// shown verbatim in its own "From the passage" box via display_sentence,
// which has no length cap, while this hint feeds into a "message" that
// DOES (12 words per sentence, checked by the real frontend's
// validator). A real passage sentence can easily run past that on its
// own, so repeating it inside a length-capped field risked failing
// validation on every retry for an otherwise perfectly fine word.
function buildContextualHint(word, allMsgs) {
  const passageText = extractPassageText(allMsgs);
  const sentence = getSentenceContaining(passageText, word);
  if (sentence && sentence.trim()) {
    return "Look at the sentence above again. Which meaning fits best there?";
  }
  return "Think about how \"" + word + "\" is used here.";
}

/* ---------------- diagnostic report templates ---------------- */
const SUMMARY_STRUGGLED_TEMPLATES = [
  function (n) { return "Solid grasp of most words; " + n + " needed extra support and should be revisited."; },
  function (n) { return "Good progress overall, with " + n + " word(s) worth a second look next lesson."; },
];
const SUMMARY_STRONG_TEMPLATES = [
  function () { return "Strong session — every word resolved independently with no real struggle."; },
  function () { return "Excellent session — every word was worked out independently, no hints needed."; },
];
const RELIABLE_HEADLINE_TEMPLATES = [
  function () { return "Answers were generally well-paced."; },
  function () { return "The pacing across this session looked realistic overall."; },
];
const WHAT_TO_TRY_STRUGGLED_INTROS = [
  function (list) { return "Revisit " + list + " in a new sentence next lesson."; },
  function (list) { return "Give " + list + " one more pass, ideally in a fresh sentence."; },
];
const WHAT_TO_TRY_STRONG_TEMPLATES = [
  function () { return "Keep going at this pace — try a slightly harder passage next."; },
  function () { return "This student is ready to move faster — consider a tougher passage next time."; },
];

/* ---------------- /api/claude mock ---------------- */
// promptId is the same field the real /api/claude endpoint dispatches on
// (see api/_claudeHandler.js's PROMPT_BUILDERS) -- matching on it directly
// here, instead of sniffing prompt text, is both simpler and immune to the
// prompt-text-matching bugs the real endpoint used to have to worry about.
function mockClaude(promptId, messages) {
  const allMsgs = (messages || []).map(function (m) { return m.content; }).join("\n");
  const lastMsg = (messages && messages[messages.length - 1] && messages[messages.length - 1].content) || "";

  // Diagnostic engine — reads the REAL log the client sends, so the
  // underlying claims are a genuine (if simple) analysis of real data;
  // only the wrapping sentences are varied.
  if (promptId === "diagnostic") {
    const logMatch = /Log \(chronological, oldest first\):\n(\[[\s\S]*?\])\n\nWhole-passage/.exec(allMsgs);
    let log = [];
    try { log = logMatch ? JSON.parse(logMatch[1]) : []; } catch (e) { log = []; }
    const solved = log.filter(function (e) { return !e.skipped; });
    const struggled = solved.filter(function (e) { return (e.hintsUsed || 0) > 0 || (e.finalStage || 0) >= 4; });
    const easy = solved.filter(function (e) { return (e.hintsUsed || 0) === 0 && (e.finalStage || 0) < 4; });
    const compSplit = allMsgs.split("Whole-passage comprehension check:")[1] || "";
    const compMatch = /"correct":\s*(true|false|null)/.exec(compSplit);
    const compCorrect = compMatch ? compMatch[1] : "null";
    const strugglingList = struggled.map(function (e) { return "\"" + e.word + "\""; }).join(", ");
    const easyList = easy.map(function (e) { return "\"" + e.word + "\""; }).join(", ");
    return {
      summary: struggled.length ? pickOne(SUMMARY_STRUGGLED_TEMPLATES)(struggled.length) : pickOne(SUMMARY_STRONG_TEMPLATES)(),
      corePattern:
        "**" + easy.length + " of " + solved.length + " words resolved quickly and independently.**\n\n" +
        (easy.length ? "- " + easyList + " resolved with no hints needed.\n" : "") +
        (struggled.length ? "- " + strugglingList + " needed more support — worth a quick revisit.\n" : "") +
        "- " + log.filter(function (e) { return e.skipped; }).length + " word(s) skipped this session.",
      howReliable:
        "**" + pickOne(RELIABLE_HEADLINE_TEMPLATES)() + "**\n\n- " + log.filter(function (e) { return e.answeredAtFloor; }).length + " answer(s) landed right at the pacing floor, a possible guess.\n- " + (log.length - log.filter(function (e) { return e.answeredAtFloor; }).length) + " answer(s) took a realistic reading time.",
      storyUnderstandingNote:
        compCorrect === "true" ? "Passed the whole-passage comprehension check on the first try." :
        compCorrect === "false" ? "Missed the whole-passage comprehension check — worth checking they followed the story, not just the words." :
        "No comprehension check ran this session.",
      whatToTry:
        struggled.length
          ? "**" + pickOne(WHAT_TO_TRY_STRUGGLED_INTROS)(strugglingList) + "**\n\n- Ask the student to use it out loud before writing it down.\n- Pair it with a concrete example from their own life."
          : "**" + pickOne(WHAT_TO_TRY_STRONG_TEMPLATES)() + "**\n\n- This student is ready for less scaffolding.",
    };
  }

  // Transfer test -- only reachable for a word that was just coached, so
  // the literal word is always present; if it has no curated entry, borrow
  // another word's meaning/distractor shape (self-consistent MCQ, just not
  // a real definition) rather than fail this rare, low-stakes check.
  if (promptId === "transfer_test") {
    const word = findLiteralWord(allMsgs) || KNOWN_WORDS[Math.floor(Math.random() * KNOWN_WORDS.length)];
    const w = WORDS[word] || WORDS[KNOWN_WORDS[Math.floor(Math.random() * KNOWN_WORDS.length)]];
    const distractors = pickDistinct(w.distractors, 3, null);
    const options = [w.meaning].concat(distractors).sort(function () { return Math.random() - 0.5; });
    return {
      sentence: "Even in a totally different situation, everyone agreed the word \"" + word + "\" fit perfectly here too.",
      options: options,
      correctAnswer: w.meaning,
    };
  }

  // Comprehension check
  if (promptId === "comprehension") {
    let found = null;
    for (let ci = 0; ci < COMPREHENSION_BY_PASSAGE.length; ci++) {
      if (allMsgs.indexOf(COMPREHENSION_BY_PASSAGE[ci].match) !== -1) { found = COMPREHENSION_BY_PASSAGE[ci]; break; }
    }
    found = found || COMPREHENSION_BY_PASSAGE[0];
    return { question: found.question, options: found.options, correctAnswer: found.correctAnswer };
  }

  // Single-word regen (Level Maker "swap this word") -- same "must actually
  // be in the passage" requirement as the Level Maker itself.
  if (promptId === "single_word_regen") {
    const passageText = extractPassageText(allMsgs) || allMsgs;
    const alreadyChosenMatch = /Already chosen words \(don't repeat these\): (.*)/.exec(allMsgs);
    const alreadyChosen = {};
    (alreadyChosenMatch ? alreadyChosenMatch[1].split(",") : []).forEach(function (w) { alreadyChosen[w.trim().toLowerCase()] = true; });
    const realWords = extractRealWords(passageText).filter(function (w) { return !alreadyChosen[w]; });
    const knownInPassage = realWords.filter(function (w) { return KNOWN_WORDS.indexOf(w) !== -1; });
    const word = knownInPassage[0] || realWords[0] || KNOWN_WORDS[Math.floor(Math.random() * KNOWN_WORDS.length)];
    return { word: word, clueType: "inference", concreteness: "abstract" };
  }

  // Level Maker — picks words that actually appear in the pasted passage,
  // preferring the curated dictionary (now 50 words, up from 20) so more
  // custom passages get real MCQ content instead of the generic fallback.
  if (promptId === "level_maker") {
    const passageText = extractPassageText(allMsgs) || allMsgs;
    const realWords = extractRealWords(passageText);
    const realWordSet = {};
    realWords.forEach(function (w) { realWordSet[w] = true; });
    const knownInPassage = KNOWN_WORDS.filter(function (w) { return realWordSet[w]; });
    const otherRealWords = realWords.filter(function (w) { return KNOWN_WORDS.indexOf(w) === -1; });
    let chosen = pickDistinct(knownInPassage, 5, null);
    if (chosen.length < 5) chosen = chosen.concat(pickDistinct(otherRealWords, 5 - chosen.length, null));
    if (chosen.length < 5) chosen = chosen.concat(pickDistinct(KNOWN_WORDS, 5 - chosen.length, null));
    const picks = chosen.slice(0, 5).map(function (word) { return { word: word, clueType: "inference", concreteness: "abstract" }; });
    return {
      emoji: "📘",
      mission: "A new adventure awaits! Learn these 5 words to complete the story.",
      arrival: "You did it! Every word learned, story complete.",
      readabilityLevel: "about_right",
      readabilityNote: "Sentence length and vocabulary look appropriate for Year 4-6 ESL learners.",
      words: picks,
    };
  }

  // Coach — the core loop. Uses the "[FACT: this answer is ...]" tag the
  // real frontend already includes in the student's message to know the
  // verdict without needing any real language understanding.
  if (promptId === "coach") {
    const word = findLiteralWord(allMsgs) || KNOWN_WORDS[Math.floor(Math.random() * KNOWN_WORDS.length)];
    const w = WORDS[word];
    const isFirstTurn = messages.length <= 1;

    // The real frontend always sends the coach's own previous reply back
    // as a JSON-stringified assistant message (see submitAnswer/startWord
    // in src/App.jsx) -- reading it back out is a far more reliable way
    // to know what stage/type the student just answered than re-deriving
    // it from FACT-tag counts, and it's the only way that works
    // uniformly for "text" turns too (Stage 4/5 never get a deterministic
    // [FACT: this answer is CORRECT] tag at all, since the real app
    // leaves that judgment to the AI).
    let priorStage = 1;
    let priorInputType = null;
    if (!isFirstTurn) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          try {
            const priorParsed = JSON.parse(messages[i].content);
            priorStage = priorParsed.stage || 1;
            priorInputType = priorParsed.input_type || null;
          } catch (e) { /* keep the stage-1 default */ }
          break;
        }
      }
    }

    const wasCorrect = /\[FACT: this answer is CORRECT\./.test(lastMsg);
    const missingWordFact = /\[FACT: the answer does not contain the target word/.test(lastMsg);
    const accepted = priorInputType === "text" ? !missingWordFact : wasCorrect;

    // Progression: a brand new word always starts at Stage 1; a correct
    // answer advances exactly one stage at a time (so a full playthrough
    // demonstrates every mechanic, not just some of them); an incorrect
    // one gets a hint and retries the SAME stage. Only succeeding at
    // Stage 5 resolves the word here -- the real coach can resolve early
    // at Stage 4, but a demo mock deliberately doesn't take that
    // shortcut, so a full correct playthrough always shows all 5 stages
    // rather than sometimes stopping at 4.
    let stage = 1;
    let hintGiven = false;
    let resolved = false;
    if (!isFirstTurn) {
      if (accepted) {
        if (priorStage >= 5) { stage = priorStage; resolved = true; }
        else { stage = priorStage + 1; }
      } else {
        stage = priorStage;
        hintGiven = true;
      }
    }

    const hintText = (w && w.hint) || buildContextualHint(word, allMsgs);
    const passageText = extractPassageText(allMsgs);
    let groundedSentence = getSentenceContaining(passageText, word);
    groundedSentence = (groundedSentence && groundedSentence.trim()) || ("The passage uses \"" + word + "\" — read the sentence carefully.");

    // Stage 1: MCQ. Uses the word's own curated meaning/distractors when
    // available; otherwise borrows another known word's shape (a
    // self-consistent MCQ, not a real definition for this word) rather
    // than fail outright -- same trade-off transfer_test's own fallback
    // makes further down. Deliberately never "text" here: the real coach
    // never uses free typing at Stage 1 either (see STAGE1_CYCLE).
    if (stage === 1) {
      const shape = w || WORDS[KNOWN_WORDS[Math.floor(Math.random() * KNOWN_WORDS.length)]];
      const options = [shape.meaning].concat(pickDistinct(shape.distractors, 3, null)).sort(function () { return Math.random() - 0.5; });
      const message = isFirstTurn ? pickOne(INTRO_TEMPLATES)(word) : pickOne(WRONG_WRAPPERS)(hintText);
      return { message: message, display_sentence: groundedSentence, input_type: "mcq", options: options, word_tiles: null, correct_answer: shape.meaning, sentence_starter: null, stage: 1, grading_reasoning: null, hint_given: hintGiven, resolved: false, fun_fact: null };
    }

    // Stage 2: word_bank or letter_connect (deterministic per word, so a
    // retry after a wrong spelling attempt stays the same mechanic).
    if (stage === 2) {
      const inputType = word.charCodeAt(0) % 2 === 0 ? "word_bank" : "letter_connect";
      const message = hintGiven ? "Not quite, try spelling it again!" : pickOne(ADVANCE_TEMPLATES)(word);
      return { message: message, display_sentence: groundedSentence, input_type: inputType, options: null, word_tiles: shuffleLetters(word), correct_answer: null, sentence_starter: null, stage: 2, grading_reasoning: null, hint_given: hintGiven, resolved: false, fun_fact: null };
    }

    // Stage 3: tap_select (odd-one-out among 4 single words -- the target
    // word plus a curated synonym pair, and one word that clearly doesn't
    // share that meaning, which is correct_answer) or reverse_clue (word
    // used correctly, grounded in the real passage sentence when it has
    // enough other words to draw options from, otherwise falls back to
    // tap_select too, which never depends on passage length at all).
    if (stage === 3) {
      const inputType = word.length % 2 === 0 ? "tap_select" : "reverse_clue";
      if (inputType === "tap_select") {
        const group = oddOneOutFor(word);
        const message = hintGiven ? "Not quite, think about what it means!" : "Which word doesn't belong?";
        const options = [word].concat(group.belongs, [group.odd]).sort(function () { return Math.random() - 0.5; });
        return { message: message, display_sentence: groundedSentence, input_type: "tap_select", options: options, word_tiles: null, correct_answer: group.odd, sentence_starter: null, stage: 3, grading_reasoning: null, hint_given: hintGiven, resolved: false, fun_fact: null };
      }
      // reverse_clue now tests whole-passage comprehension: the student
      // picks which OTHER sentence explains the target word's meaning,
      // not a single word from its own sentence. Every option must be a
      // real, verbatim sentence from the actual passage -- the real
      // frontend's validator checks this, so fabricating one here would
      // fail validation on every retry rather than just look wrong.
      const wordRe = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
      const otherSentences = splitIntoSentences(passageText).filter(function (s) { return !wordRe.test(s); });
      if (otherSentences.length >= 3) {
        const picked = otherSentences.slice(0, 3);
        const correctSentence = picked[0];
        const options = picked.slice().sort(function () { return Math.random() - 0.5; });
        const message = hintGiven ? "Not quite, think back through the story!" : "Which sentence explains why?";
        return { message: message, display_sentence: groundedSentence, input_type: "reverse_clue", options: options, word_tiles: null, correct_answer: correctSentence, sentence_starter: null, stage: 3, grading_reasoning: null, hint_given: hintGiven, resolved: false, fun_fact: null };
      }
      // Passage too short to offer 3 genuine OTHER sentences (shouldn't
      // happen for a real 80-150 word passage) -- fall back to tap_select,
      // which has no such requirement.
      const fallbackGroup = oddOneOutFor(word);
      const fallbackMessage = hintGiven ? "Not quite, think about what it means!" : "Which word doesn't belong?";
      const fallbackOptions = [word].concat(fallbackGroup.belongs, [fallbackGroup.odd]).sort(function () { return Math.random() - 0.5; });
      return { message: fallbackMessage, display_sentence: groundedSentence, input_type: "tap_select", options: fallbackOptions, word_tiles: null, correct_answer: fallbackGroup.odd, sentence_starter: null, stage: 3, grading_reasoning: null, hint_given: hintGiven, resolved: false, fun_fact: null };
    }

    // Stage 4: finish the sentence. Grading is generous, same as the real
    // coach's own CORRECTNESS rule -- any attempt that actually uses the
    // target word is accepted (missingWordFact is the one thing checked
    // deterministically client-side either way).
    if (stage === 4) {
      // Never resolved here -- see the progression comment above, Stage 4
      // always advances to Stage 5 on success rather than ending early.
      const message = hintGiven ? "Try finishing the sentence again!" : "Finish this sentence!";
      // Only frame the word as "The <word> was very" when the passage
      // actually uses it as a noun -- most CORE_WORDS are adjectives, and
      // that template forces an adjective into a noun-subject slot
      // otherwise (e.g. "The reluctant was very ___").
      const starter = wordUsedAsNounInMock(groundedSentence, word) ? ("The " + word + " was very") : ("It was very " + word);
      return { message: message, display_sentence: groundedSentence, input_type: "text", options: null, word_tiles: null, correct_answer: null, sentence_starter: starter, stage: 4, grading_reasoning: null, hint_given: hintGiven, resolved: false, fun_fact: null };
    }

    // Stage 5: write an original sentence, no scaffolding.
    if (resolved) {
      return { message: pickOne(FINAL_RESOLVED_TEMPLATES)(word), display_sentence: groundedSentence, input_type: "text", options: null, word_tiles: null, correct_answer: null, sentence_starter: null, stage: 5, grading_reasoning: null, hint_given: false, resolved: true, fun_fact: "Great context-clue reading!" };
    }
    const message = hintGiven ? "Try writing your own sentence with \"" + word + "\" again!" : "Now write your own sentence with \"" + word + "\"!";
    return { message: message, display_sentence: groundedSentence, input_type: "text", options: null, word_tiles: null, correct_answer: null, sentence_starter: null, stage: 5, grading_reasoning: null, hint_given: hintGiven, resolved: false, fun_fact: null };
  }

  return { message: "OK", display_sentence: "OK", input_type: "text", options: null, word_tiles: null, correct_answer: null, sentence_starter: null, stage: 1, hint_given: false, resolved: true, fun_fact: null };
}

export {
  WORDS,
  KNOWN_WORDS,
  COMPREHENSION_BY_PASSAGE,
  findLiteralWord,
  pickDistinct,
  pickOne,
  extractPassageText,
  getSentenceContaining,
  extractRealWords,
  mockClaude,
};
