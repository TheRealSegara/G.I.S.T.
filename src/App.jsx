import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Sparkles, RotateCcw, ArrowRight, GraduationCap, ChevronLeft, Trophy, Footprints, Play, Wrench } from "lucide-react";
import {
  SESSION_WORD_COUNT,
  COMPANION_PERSONAS,
  STAGE1_CYCLE,
  STAGE2_CYCLE,
  STAGE3_CYCLE,
  buildCoachSystemPrompt,
  TRANSFER_TEST_SYSTEM_PROMPT,
  COMPREHENSION_SYSTEM_PROMPT,
  SINGLE_WORD_REGEN_PROMPT,
  LEVEL_MAKER_SYSTEM_PROMPT,
  DIAGNOSTIC_SYSTEM_PROMPT,
} from "../shared/prompts.js";

/* ---------------- Fonts ---------------- */
const FontImport = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@500;700;800&family=Patrick+Hand&display=swap');
    .font-display { font-family: 'Baloo 2', cursive; }
    .font-hand { font-family: 'Patrick Hand', cursive; }
    .font-body { font-family: 'Nunito', sans-serif; }
    .dot-trail {
      background-image: radial-gradient(rgba(16,185,129,0.15) 2px, transparent 2px);
      background-size: 14px 14px;
    }
    @keyframes stepIn { from { opacity:0; transform: translateY(8px) scale(0.98); } to { opacity:1; transform: translateY(0) scale(1); } }
    .step-in { animation: stepIn 0.28s ease-out both; }
    @keyframes bounce-in { 0% { transform: scale(0.7); opacity:0;} 60% { transform: scale(1.08); opacity:1;} 100% { transform: scale(1);} }
    .bounce-in { animation: bounce-in 0.4s ease-out; }
    @keyframes float { 0%,100% { transform: translateY(0) rotate(var(--r,0deg)); } 50% { transform: translateY(-10px) rotate(var(--r,0deg)); } }
    .float-slow { animation: float 5s ease-in-out infinite; }
    .float-med { animation: float 3.5s ease-in-out infinite; }
    @keyframes wiggle { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
    .wiggle { animation: wiggle 2.2s ease-in-out infinite; }
    .sticker-title { color: #9a3412; }
    .sticker-title-teal { color: #134e4a; }
    @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .spin-slow { animation: spin-slow 90s linear infinite; }
    @keyframes confettiFall {
      0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
      100% { transform: translateY(110vh) rotate(var(--rot, 360deg)); opacity: 0.9; }
    }
    .confetti-piece { animation-name: confettiFall; animation-timing-function: ease-in; animation-fill-mode: forwards; }
    @keyframes sparklePop {
      0% { transform: translate(0,0) scale(0.3); opacity: 0; }
      30% { opacity: 1; }
      100% { transform: translate(var(--sx,0), var(--sy,0)) scale(1); opacity: 0; }
    }
    .sparkle-piece { animation: sparklePop 0.7s ease-out forwards; }
    .parchment-card {
      background-image: radial-gradient(ellipse at center, rgba(217,119,6,0.04) 0%, rgba(217,119,6,0.09) 100%);
    }
    /* Buttons/inputs across the app use focus:outline-none with only a
       border-color change as a substitute; this restores a strong,
       keyboard-only focus indicator on top of that without touching every
       component's className. */
    :focus-visible {
      outline: 3px solid #2563eb !important;
      outline-offset: 2px !important;
    }
    @media (prefers-reduced-motion: reduce) {
      .step-in, .bounce-in, .float-slow, .float-med, .wiggle, .spin-slow,
      .confetti-piece, .sparkle-piece,
      .animate-pulse, .animate-bounce {
        animation: none !important;
      }
      .answer-settle {
        transition: none !important;
      }
    }
    /* Second pacing-gate phase: answer options render right away but
       stay dimmed/unpressable until answersEnabled flips, via inline
       opacity/transform/pointerEvents driven from JS. The transition
       itself (not the gate timing) is what prefers-reduced-motion
       above turns off, so reduced-motion users still get the same
       hold, just without the animated settle. */
    .answer-settle {
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
  `}</style>
);

const DECOR_ITEMS = ["🧭", "📍", "⛰️", "🌴", "⛵", "🗺️", "✨", "⭐", "🦋", "🎈"];
function FloatingDecor({ density = 6 }) {
  const items = Array.from({ length: density }).map((_, i) => ({
    emoji: DECOR_ITEMS[i % DECOR_ITEMS.length],
    top: `${8 + ((i * 37) % 80)}%`,
    left: `${5 + ((i * 53) % 90)}%`,
    size: 20 + ((i * 13) % 20),
    delay: `${(i * 0.6) % 3}s`,
    cls: i % 2 === 0 ? "float-slow" : "float-med",
  }));
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden opacity-40" aria-hidden="true">
      {items.map((it, i) => (
        <span
          key={i}
          className={`absolute ${it.cls}`}
          style={{ top: it.top, left: it.left, fontSize: it.size, animationDelay: it.delay }}
        >
          {it.emoji}
        </span>
      ))}
    </div>
  );
}

// Thick, square-cornered, palette-colored viewport border. Fixed overlay,
// no ornamentation — the "which mode am I in" cue for the whole screen.
function OuterFrame({ tone = "gold" }) {
  const color = tone === "teal" ? "#0d9488" : "#f59e0b";
  return (
    <div
      className="pointer-events-none fixed inset-0"
      style={{ border: `8px solid ${color}`, zIndex: 9999 }}
      aria-hidden="true"
    />
  );
}

const AMBIENT_ICONS_GOLD = ["🧭", "🗺️", "⛰️", "🌴", "⛵"];
const AMBIENT_ICONS_TEAL = ["📊", "📋", "🔍", "📖", "✨"];
// top/left keep every spot within a 16-70% vertical band so it can't crowd
// a screen's header/footer content on a short landscape tablet (the app's
// actual target device) — in particular, every screen with AmbientIcons
// also has the fixed 44px CloseButton/SoundToggle pinned at top-4 left-4 /
// top-4 right-4, so spots stay clear of both top corners, not just an
// arbitrary top margin. Size uses clamp() against vh so the icon shrinks
// with viewport height instead of just overflowing on one.
const AMBIENT_ICON_SPOTS = [
  { top: "16%", left: "3%", size: "clamp(70px, 18vh, 160px)", cls: "float-slow" },
  { top: "52%", left: "88%", size: "clamp(80px, 21vh, 190px)", cls: "float-med" },
  { top: "68%", left: "8%", size: "clamp(65px, 15vh, 130px)", cls: "float-slow" },
];
// A handful of large, very faint background icons that vary by palette,
// reinforcing which "mode" (student/gold vs teacher/teal) a screen is in.
// Reuses the existing float-slow/float-med classes (already covered by the
// app's prefers-reduced-motion disable list) rather than adding new motion.
function AmbientIcons({ palette = "gold" }) {
  const icons = palette === "teal" ? AMBIENT_ICONS_TEAL : AMBIENT_ICONS_GOLD;
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      {AMBIENT_ICON_SPOTS.map((spot, i) => (
        <span
          key={i}
          className={`absolute ${spot.cls}`}
          style={{ top: spot.top, left: spot.left, fontSize: spot.size, opacity: 0.07 }}
        >
          {icons[i % icons.length]}
        </span>
      ))}
    </div>
  );
}

const CONFETTI_COLORS = ["#f59e0b", "#0d9488", "#fbbf24", "#5eead4", "#ffffff"];
function Confetti({ count = 40 }) {
  const pieces = Array.from({ length: count }).map((_, i) => ({
    left: `${Math.random() * 100}%`,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: `${Math.random() * 0.6}s`,
    duration: `${2.2 + Math.random() * 1.4}s`,
    size: 6 + Math.random() * 6,
    rot: `${180 + Math.random() * 540}deg`,
    round: Math.random() > 0.5,
  }));
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 60 }} aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece absolute top-0"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.round ? "50%" : "2px",
            animationDelay: p.delay,
            animationDuration: p.duration,
            "--rot": p.rot,
          }}
        />
      ))}
    </div>
  );
}

function Sparkle({ count = 8 }) {
  const pieces = Array.from({ length: count }).map((_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const dist = 30 + Math.random() * 20;
    return {
      sx: `${Math.cos(angle) * dist}px`,
      sy: `${Math.sin(angle) * dist}px`,
      delay: `${Math.random() * 0.1}s`,
    };
  });
  return (
    <span className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ zIndex: 30 }}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="sparkle-piece absolute left-1/2 top-1/2 text-sm"
          style={{ "--sx": p.sx, "--sy": p.sy, animationDelay: p.delay }}
        >
          ✨
        </span>
      ))}
    </span>
  );
}

// Decorative cartoon cloud silhouette, used for the passage screen's
// not-yet-reachable placeholders and its reveal button. Purely visual
// (aria-hidden), so it can freely stretch/crop to whatever box it's
// dropped into via preserveAspectRatio="slice" rather than needing an
// exact-fit viewBox per call site.
function CloudShape({ fill = "#e0f2fe", className = "" }) {
  return (
    <svg viewBox="0 0 200 80" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <ellipse cx="45" cy="46" rx="34" ry="24" fill={fill} />
      <ellipse cx="90" cy="30" rx="38" ry="28" fill={fill} />
      <ellipse cx="140" cy="42" rx="36" ry="26" fill={fill} />
      <ellipse cx="175" cy="52" rx="26" ry="18" fill={fill} />
      <rect x="18" y="42" width="164" height="28" rx="14" fill={fill} />
    </svg>
  );
}

// Puff-of-cloud burst, fired when a new part of the passage is revealed.
// Same particle-burst mechanic as Sparkle (reuses its .sparkle-piece
// animation, which is just translate+scale+opacity, not sparkle-specific),
// with a cloud emoji instead so it reads as "the cloud drifted away."
function CloudPuff({ count = 6 }) {
  const pieces = Array.from({ length: count }).map((_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const dist = 26 + Math.random() * 18;
    return {
      sx: `${Math.cos(angle) * dist}px`,
      sy: `${Math.sin(angle) * dist}px`,
      delay: `${Math.random() * 0.08}s`,
    };
  });
  return (
    <span className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ zIndex: 30 }}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="sparkle-piece absolute left-1/2 top-1/2 text-sm"
          style={{ "--sx": p.sx, "--sy": p.sy, animationDelay: p.delay }}
        >
          ☁️
        </span>
      ))}
    </span>
  );
}

/* ---------------- Content data ---------------- */
// Small logo mark, used on the 3 screen headers (main menu, PassageScreen,
// AccessGateScreen) — recolors per `tone` to match that screen's palette
// (gold for student-facing screens, teal for the teacher-facing access gate).
function CompassRose({ size = 220, spin = false, className = "", tone = "gold" }) {
  const palette = tone === "teal"
    ? { ring: "#0f766e", star: "#0d9488", center: "#134e4a" }
    : { ring: "#c2410c", star: "#f59e0b", center: "#9a3412" };
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={`${className} ${spin ? "spin-slow" : ""}`} aria-hidden="true">
      <circle cx="100" cy="100" r="94" fill="none" stroke={palette.ring} strokeWidth="2" opacity="0.55" />
      <circle cx="100" cy="100" r="78" fill="none" stroke={palette.ring} strokeWidth="1" opacity="0.4" />
      <g opacity="0.6">
        <polygon points="100,8 111,100 100,192 89,100" fill={palette.star} />
        <polygon points="8,100 100,89 192,100 100,111" fill={palette.star} />
      </g>
      <g opacity="0.35" transform="rotate(45 100 100)">
        <polygon points="100,28 106,100 100,172 94,100" fill={palette.star} />
        <polygon points="28,100 100,94 172,100 100,106" fill={palette.star} />
      </g>
      <circle cx="100" cy="100" r="7" fill={palette.center} />
      <text x="100" y="26" textAnchor="middle" fontSize="15" fontWeight="800" fill={palette.center} fontFamily="Baloo 2, cursive">N</text>
      <text x="100" y="182" textAnchor="middle" fontSize="15" fontWeight="800" fill={palette.center} fontFamily="Baloo 2, cursive">S</text>
      <text x="17" y="105" textAnchor="middle" fontSize="15" fontWeight="800" fill={palette.center} fontFamily="Baloo 2, cursive">W</text>
      <text x="183" y="105" textAnchor="middle" fontSize="15" fontWeight="800" fill={palette.center} fontFamily="Baloo 2, cursive">E</text>
    </svg>
  );
}

// Clean rounded-card shape, shared everywhere, in three border tones: gold
// for student-facing screens, teal for teacher-facing screens, neutral for
// plain containers (like the cross-cutting close-confirm modal) with no
// audience of its own. Replaces the old deckle-edge/parchment DECKLE (and
// KID_CARD) shape.
const CARD_SHADOW = "0 4px 16px rgba(0,0,0,0.08)";
// Heavier static shadow for the one "main thing" card on a screen, so it
// visibly outranks the routine cards around it (which keep CARD_SHADOW).
const CARD_SHADOW_HERO = "0 10px 28px rgba(0,0,0,0.14)";
const CARD_GOLD = { borderRadius: "1.5rem", border: "3px solid #f59e0b", boxShadow: CARD_SHADOW };
const CARD_TEAL = { borderRadius: "1.5rem", border: "3px solid #0d9488", boxShadow: CARD_SHADOW };
const CARD_NEUTRAL = { borderRadius: "1.5rem", border: "3px solid #e7e5e4", boxShadow: CARD_SHADOW };

const AVATAR_HEADS = [
  { id: "child", base: "🧒", label: "Explorer" },
  { id: "girl", base: "👧", label: "Explorer" },
  { id: "boy", base: "👦", label: "Explorer" },
];

const SKIN_TONES = [
  { id: "default", mod: "", label: "Default" },
  { id: "light", mod: "🏻", label: "Light" },
  { id: "medlight", mod: "🏼", label: "Medium-light" },
  { id: "medium", mod: "🏽", label: "Medium" },
  { id: "meddark", mod: "🏾", label: "Medium-dark" },
  { id: "dark", mod: "🏿", label: "Dark" },
];

const BADGE_COLORS = [
  { id: "khaki", label: "Khaki", gradient: "linear-gradient(135deg,#e5decf,#a8a878)" },
  { id: "red", label: "Red", gradient: "linear-gradient(135deg,#fca5a5,#dc2626)" },
  { id: "blue", label: "Blue", gradient: "linear-gradient(135deg,#93c5fd,#2563eb)" },
  { id: "purple", label: "Purple", gradient: "linear-gradient(135deg,#c4b5fd,#7c3aed)" },
  { id: "green", label: "Green", gradient: "linear-gradient(135deg,#86efac,#16a34a)" },
  { id: "orange", label: "Orange", gradient: "linear-gradient(135deg,#fdba74,#ea580c)" },
  { id: "teal", label: "Teal", gradient: "linear-gradient(135deg,#5eead4,#0d9488)" },
  { id: "pink", label: "Pink", gradient: "linear-gradient(135deg,#f9a8d4,#db2777)" },
];

const ACCESSORY_STICKERS = [
  { id: "backpack", emoji: "🎒", label: "Backpack" },
  { id: "cap", emoji: "🧢", label: "Cap" },
  { id: "sunglasses", emoji: "🕶️", label: "Sunglasses" },
  { id: "binoculars", emoji: "🔭", label: "Binoculars" },
  { id: "compass", emoji: "🧭", label: "Compass" },
  { id: "boots", emoji: "🥾", label: "Boots" },
  { id: "camera", emoji: "📷", label: "Camera" },
  { id: "none", emoji: "", label: "No Gear" },
];

const ANIMAL_COMPANIONS = [
  { id: "orangutan", emoji: "🦧", label: "Orang Utan" },
  { id: "tiger", emoji: "🐯", label: "Tiger" },
  { id: "parrot", emoji: "🦜", label: "Parrot" },
  { id: "turtle", emoji: "🐢", label: "Turtle" },
  { id: "butterfly", emoji: "🦋", label: "Butterfly" },
  { id: "monkey", emoji: "🐒", label: "Monkey" },
  { id: "owl", emoji: "🦉", label: "Owl" },
  { id: "gecko", emoji: "🦎", label: "Gecko" },
];

const DEFAULT_AVATAR_CONFIG = { head: "child", skinTone: "🏽", badge: "khaki", accessory: "backpack", companion: "parrot" };

function composeAvatarEmoji(config) {
  const head = AVATAR_HEADS.find((h) => h.id === config.head) || AVATAR_HEADS[0];
  return head.base + (config.skinTone || "");
}

function AvatarDisplay({ config, size = 80 }) {
  const badge = BADGE_COLORS.find((b) => b.id === config.badge) || BADGE_COLORS[0];
  const accessory = ACCESSORY_STICKERS.find((a) => a.id === config.accessory);
  return (
    <div
      className="relative inline-flex items-center justify-center rounded-full shrink-0"
      style={{ width: size, height: size, background: badge.gradient, border: "3px solid white", boxShadow: "0 4px 0 0 rgba(0,0,0,0.12)" }}
    >
      <span style={{ fontSize: size * 0.55, lineHeight: 1 }}>{composeAvatarEmoji(config)}</span>
      {accessory && accessory.emoji && (
        <span
          className="absolute rounded-full bg-white flex items-center justify-center"
          style={{
            bottom: -size * 0.05,
            right: -size * 0.05,
            width: size * 0.42,
            height: size * 0.42,
            fontSize: size * 0.24,
            border: "2px solid white",
            boxShadow: "0 2px 0 0 rgba(0,0,0,0.15)",
          }}
        >
          {accessory.emoji}
        </span>
      )}
    </div>
  );
}

const MAP_THEMES = [
  { name: "amber", gradient: "linear-gradient(135deg,#fde68a,#fbbf24)", border: "#d97706", soft: "#fef3c7", text: "#92400e" },
  { name: "teal", gradient: "linear-gradient(135deg,#99f6e4,#2dd4bf)", border: "#0d9488", soft: "#ccfbf1", text: "#0f766e" },
  { name: "emerald", gradient: "linear-gradient(135deg,#a7f3d0,#34d399)", border: "#059669", soft: "#d1fae5", text: "#065f46" },
  { name: "rust", gradient: "linear-gradient(135deg,#fed7aa,#fb923c)", border: "#c2410c", soft: "#ffedd5", text: "#9a3412" },
  { name: "gold", gradient: "linear-gradient(135deg,#fde047,#facc15)", border: "#ca8a04", soft: "#fef9c3", text: "#854d0e" },
  { name: "brick", gradient: "linear-gradient(135deg,#fca5a5,#f87171)", border: "#b91c1c", soft: "#fee2e2", text: "#991b1b" },
  { name: "violet", gradient: "linear-gradient(135deg,#ddd6fe,#a78bfa)", border: "#6d28d9", soft: "#ede9fe", text: "#4c1d95" },
  { name: "sky", gradient: "linear-gradient(135deg,#bae6fd,#38bdf8)", border: "#0369a1", soft: "#e0f2fe", text: "#0c4a6e" },
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < (str || "").length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const BUILT_IN_MAP_THEME_NAMES = {
  "A Trip to the Sanctuary": "emerald",
  "The Kampung Festival": "gold",
  "Pet Show Day": "rust",
  "The Robot Show": "teal",
  "The Night Market": "brick",
  "The Kite Festival": "amber",
};

// Assigns a color to every passage in `entries` (an [id, passage] array, in
// display order) so no two entries on screen together share a color --
// built-ins claim their forced theme first, then each custom map takes the
// nearest still-free theme to its title's hash. A static reserved-vs-free
// split can't do this: with 6 of 8 themes pinned to built-ins, a fixed
// 2-color pool for customs would collide with itself the moment a teacher
// has 3+ custom maps. Only degrades (repeats a color) once there are more
// passages than themes (9+), an inherent limit of a fixed-size palette.
function getMapThemesForList(entries) {
  const used = new Set();
  const result = new Map();
  for (const [id, p] of entries) {
    const forced = BUILT_IN_MAP_THEME_NAMES[p.title];
    if (!forced) continue;
    const theme = MAP_THEMES.find((t) => t.name === forced) || MAP_THEMES[0];
    result.set(id, theme);
    used.add(theme.name);
  }
  for (const [id, p] of entries) {
    if (result.has(id)) continue;
    const startIdx = hashString(p.title) % MAP_THEMES.length;
    let theme = MAP_THEMES[startIdx];
    for (let i = 0; i < MAP_THEMES.length; i++) {
      const candidate = MAP_THEMES[(startIdx + i) % MAP_THEMES.length];
      if (!used.has(candidate.name)) { theme = candidate; break; }
    }
    result.set(id, theme);
    used.add(theme.name);
  }
  return result;
}

// SESSION_WORD_COUNT is imported from ../shared/prompts.js (fixed at 5,
// not adjustable — the original intended session length, trimmed to 3
// while running on Gemini's tight free-tier daily quota, restored now
// that Groq's free tier has far more headroom). Applies both to how many
// target words a student session covers and how many words a teacher's
// custom map generates.

// AI calls only retry on a malformed/unparseable response, not on
// network or auth/quota failures (see NON_RETRYABLE_STATUSES below).
// Raised back to 3 now that Groq's free tier has enough headroom that an
// extra retry isn't a meaningful cost, unlike under Gemini's tight quota.
const MAX_RETRY_ATTEMPTS = 3;

// Coach messages reveal letter-by-letter instead of popping in instantly.
// Doubles as the pacing gate: answer controls stay locked until the
// reveal finishes (see appendCoachMessage/TYPEWRITER_MIN_LOCK_MS below),
// which is also exactly what keeps students from rapid-clicking past
// Groq's real per-minute request ceiling.
const TYPEWRITER_CHAR_MS = 18;
// Minimum lock duration even for a one-word message, so pacing can't be
// defeated by a short coach reply typing out almost instantly.
const TYPEWRITER_MIN_LOCK_MS = 1100;

// Second phase of the same pacing gate, covering the answer options
// themselves rather than the coach's message: once the message finishes
// revealing, the options render immediately (so there's something to
// read while waiting, not just a placeholder) but stay disabled and
// visually settling-in for this long, scaled by how much reading the
// options actually take — a two-option true/false question shouldn't
// hold as long as a four-option MCQ with long phrases. Applies
// regardless of prefers-reduced-motion (see appendCoachMessage): the
// hold itself is a pedagogical pacing gate, not a decorative animation,
// only the CSS transition is what motion-reduction should skip.
const OPTIONS_READ_CHAR_MS = 35;
const OPTIONS_READ_MIN_MS = 900;

// Reads whichever field the upcoming input_type actually shows the
// student (options for mcq/true_false/tap_select/reverse_clue, tiles for
// word_bank/letter_connect, the sentence_starter for text) and turns its
// total length into the hold duration above.
function computeOptionsReadMs(parsed) {
  if (!parsed) return OPTIONS_READ_MIN_MS;
  let text = "";
  if (Array.isArray(parsed.options)) text = parsed.options.join(" ");
  else if (Array.isArray(parsed.word_tiles)) text = parsed.word_tiles.join(" ");
  else if (typeof parsed.sentence_starter === "string") text = parsed.sentence_starter;
  return Math.max(OPTIONS_READ_MIN_MS, text.length * OPTIONS_READ_CHAR_MS);
}

// Shared inline style for the settling-in visual: dimmed and slightly
// scaled down while the options hold is still running, full-strength
// and un-clickable-no-more once answersEnabled flips. pointerEvents is
// belt-and-suspenders alongside each button/input's own `disabled`.
function settlingStyle(answersEnabled) {
  return {
    opacity: answersEnabled ? 1 : 0.45,
    transform: answersEnabled ? "scale(1)" : "scale(0.97)",
    pointerEvents: answersEnabled ? "auto" : "none",
  };
}

// If a word hasn't resolved after this many student answers, auto-reveal
// it via the same free fallback Skip uses, instead of letting a stuck
// word consume an unbounded number of AI calls.
const STUCK_WORD_LIMIT = 4;

// Rough typical-case AI calls for one full session: ~2 calls per word
// (opening + one answer that resolves it) across SESSION_WORD_COUNT
// words, plus the transfer test, comprehension check, and diagnostic
// report. Deliberately the typical case, not STUCK_WORD_LIMIT's worst
// case — using the worst case here would make this check nearly always
// block, since it'd exceed most of DAILY_QUOTA_PER_CODE's default on
// its own. Used to decide whether there's enough quota left today to
// reasonably start a new session, not a hard guarantee it'll finish.
const SESSION_COST_ESTIMATE = SESSION_WORD_COUNT * 2 + 3;

const PASSAGES = {
  orangutan: {
    title: "A Trip to the Sanctuary",
    emoji: "🌴",
    mission: "The ranger needs your help! Learn these 5 words so you can tell your little brother the whole story before bedtime.",
    arrival: "You made it! Now you know the sanctuary's secret words, your brother is going to love this story tonight.",
    text: `Last Saturday, Mei Ling went to a wildlife park in Sarawak. At first, her little brother was reluctant to walk into the forest. He held his mother's hand tightly and did not want to go. Then he saw an enormous orang utan in a tree. It was very big, almost as big as a car! He forgot to feel scared. Now he felt curious. He asked question after question about the animal. The orang utan's fur felt damp. It had just rained, so everything outside was wet. The ranger said orang utans look big and strong. But they are actually gentle. They are calm and kind, and they do not hurt people.`,
    words: [
      { word: "reluctant", clueType: "contrast", concreteness: "abstract" },
      { word: "enormous", clueType: "definition", concreteness: "concrete" },
      { word: "curious", clueType: "example", concreteness: "abstract" },
      { word: "damp", clueType: "inference", concreteness: "concrete" },
      { word: "gentle", clueType: "contrast", concreteness: "abstract" },
    ],
  },
  kampung: {
    title: "The Kampung Festival",
    emoji: "🎋",
    mission: "The festival is starting! Crack these 5 words before the rice cakes are ready, so you can help Aiman welcome the guests.",
    arrival: "The rice cakes are ready and so are you! You've learned every word in the village today.",
    text: `Every year, Aiman's village has a small festival. It is a harvest festival. The kampung becomes bustling. Many visitors come. There are food stalls and children running everywhere. Aiman's grandmother looks delighted. She smiles a big smile when the rice cakes are ready. The rice cakes smell fragrant. The sweet smell of pandan leaves fills the air. By evening, after cooking and welcoming guests all day, the family feels exhausted. They worked hard, so now they feel very tired. But they are also happy. The neighbours are generous too. They share their food freely with anyone who walks by.`,
    words: [
      { word: "bustling", clueType: "example", concreteness: "abstract" },
      { word: "delighted", clueType: "definition", concreteness: "abstract" },
      { word: "fragrant", clueType: "inference", concreteness: "concrete" },
      { word: "exhausted", clueType: "contrast", concreteness: "abstract" },
      { word: "generous", clueType: "example", concreteness: "abstract" },
    ],
  },
  petshow: {
    title: "Pet Show Day",
    emoji: "🐾",
    mission: "Help Mei and her friends show off their pets! Learn these 5 words before the judges arrive.",
    arrival: "The judges loved every pet! You solved every word, just like a true pet show champion.",
    text: `Today is Pet Show day at school. Many pupils bring their pets. Mei has a small spider. Spiders can look scary, but she says they are brave hunters. Some animals use camouflage. Camouflage helps them hide from enemies. A gecko can change color like this. Ali's cat is very timid. It hides under the chair when guests come. But Ali's dog is clever. It can open doors by itself! Siti's rabbit is playful. It jumps and runs around the room all day.`,
    words: [
      { word: "brave", clueType: "contrast", concreteness: "abstract" },
      { word: "camouflage", clueType: "definition", concreteness: "abstract" },
      { word: "timid", clueType: "inference", concreteness: "abstract" },
      { word: "clever", clueType: "example", concreteness: "abstract" },
      { word: "playful", clueType: "example", concreteness: "abstract" },
    ],
  },
  robot: {
    title: "The Robot Show",
    emoji: "🤖",
    mission: "The science fair starts soon! Learn these 5 words to explain how the amazing robot works.",
    arrival: "The robot show was a huge success, and so are you! Every word explained, every clue solved.",
    text: `Last week, the school had a robot show. A scientist invented a new robot. She built it from small metal parts. The robot looks powerful. It can lift heavy boxes easily. But the robot is also careful. It never drops anything. Everyone said the robot was amazing. It can dance and sing songs too! Inside the robot is a tiny computer, smaller than your hand. The computer helps the robot think and move.`,
    words: [
      { word: "invented", clueType: "definition", concreteness: "abstract" },
      { word: "powerful", clueType: "example", concreteness: "abstract" },
      { word: "careful", clueType: "contrast", concreteness: "abstract" },
      { word: "amazing", clueType: "example", concreteness: "abstract" },
      { word: "tiny", clueType: "definition", concreteness: "concrete" },
    ],
  },
  nightmarket: {
    title: "The Night Market",
    emoji: "🏮",
    mission: "The pasar malam just opened! Learn these 5 words before all the good satay is gone.",
    arrival: "You tried everything and learned every word too — what a delicious night!",
    text: `Last Friday evening, Farah and her father visited the pasar malam near their house. The street was full of grilled chicken and sweet kuih. That warm, tasty smell in the air is called an aroma. Farah loved the aroma of the satay stall the most. The lane was busy with scooters, so her father was cautious. He was not reckless like the boys racing their bicycles nearby. Under the string lights, the fruit stalls looked dazzling, glowing like tiny jewels. One uncle was hospitable, waving every stranger over for a free taste of his cendol. By the time they walked home, Farah felt calm and content. She had nothing left to wish for.`,
    words: [
      { word: "aroma", clueType: "definition", concreteness: "concrete" },
      { word: "cautious", clueType: "contrast", concreteness: "abstract" },
      { word: "dazzling", clueType: "example", concreteness: "concrete" },
      { word: "hospitable", clueType: "inference", concreteness: "abstract" },
      { word: "content", clueType: "inference", concreteness: "abstract" },
    ],
  },
  kitefestival: {
    title: "The Kite Festival",
    emoji: "🪁",
    mission: "The wind is perfect and the kites are ready! Learn these 5 words before your kite takes flight.",
    arrival: "Your kite soared higher than anyone else's — every word learned, every clue caught!",
    text: `Every year, Hakim's kampung holds a kite festival by the paddy fields. Kite makers spend weeks building a wau from bamboo and colorful paper. The frame must be sturdy, strong enough to survive the wind without snapping. Hakim's uncle is a skillful kite flyer; he can make his wau dance and spin exactly where he wants. The finished kite was covered in vivid patterns, so bright that everyone could spot it from far away. Before the contest began, Hakim felt anxious, worried his string might snap in front of the whole village. But once his kite rose above the trees, steady and tall, he felt triumphant. He had won without even needing the judges to say so.`,
    words: [
      { word: "sturdy", clueType: "definition", concreteness: "concrete" },
      { word: "skillful", clueType: "example", concreteness: "abstract" },
      { word: "vivid", clueType: "inference", concreteness: "concrete" },
      { word: "anxious", clueType: "definition", concreteness: "abstract" },
      { word: "triumphant", clueType: "contrast", concreteness: "abstract" },
    ],
  },
};

const STAGE_LABELS = {
  1: "Multiple Choice",
  2: "Fill the Blank",
  3: "Fix the Mistake",
  4: "Finish the Sentence",
  5: "Free Sentence",
};

const STAGE_COLORS = {
  1: "bg-emerald-400",
  2: "bg-teal-400",
  3: "bg-amber-400",
  4: "bg-orange-400",
  5: "bg-rose-400",
};

const STAGE_INSTRUCTIONS = {
  1: { icon: "🧭", text: "Pick the best answer" },
  2: { icon: "📍", text: "Type the missing word" },
  3: { icon: "🛠️", text: "Find and fix the mistake" },
  4: { icon: "🗺️", text: "Finish the sentence" },
  5: { icon: "🚩", text: "Write your own sentence" },
};

const INPUT_TYPE_INSTRUCTIONS = {
  mcq: { icon: "👉", text: "Pick the best answer" },
  true_false: { icon: "🤔", text: "True or false?" },
  tap_select: { icon: "👆", text: "Tap the wrong word" },
  word_bank: { icon: "🔤", text: "Tap the letters to spell it" },
  letter_connect: { icon: "🔗", text: "Connect the letters to spell it" },
  reverse_clue: { icon: "🕵️", text: "Tap the clue that helped you" },
  text: { icon: "✍️", text: "Type your answer" },
};

const STAGE_GRADIENTS = {
  1: "linear-gradient(135deg,#34d399,#10b981)",
  2: "linear-gradient(135deg,#22d3ee,#0891b2)",
  3: "linear-gradient(135deg,#fbbf24,#d97706)",
  4: "linear-gradient(135deg,#fb923c,#ea580c)",
  5: "linear-gradient(135deg,#f472b6,#db2777)",
};

// Stage 3's two "word present" mechanics (tap_select, reverse_clue) used to
// clash: the instruction badge above the chips always took STAGE_GRADIENTS[3]
// (amber, since both are stage 3), while the chips themselves were colored
// per input_type (amber for tap_select, teal for reverse_clue) -- so
// reverse_clue showed an amber badge over teal chips. This is the single
// source of truth both now pull from, so a mechanic reads as one consistent
// color everywhere it appears (badge, chips, chip-area background, and the
// "From the passage" reference box).
const INPUT_TYPE_ACCENT = {
  tap_select: { border: "#f59e0b", shadow: "#c2410c", soft: "#fef3c7", gradient: "linear-gradient(135deg,#fbbf24,#d97706)" },
  reverse_clue: { border: "#0d9488", shadow: "#0f766e", soft: "#ccfbf1", gradient: "linear-gradient(135deg,#5eead4,#0d9488)" },
};

// COMPANION_PERSONAS, buildCoachSystemPrompt, TRANSFER_TEST_SYSTEM_PROMPT,
// COMPREHENSION_SYSTEM_PROMPT, SINGLE_WORD_REGEN_PROMPT,
// LEVEL_MAKER_SYSTEM_PROMPT, and DIAGNOSTIC_SYSTEM_PROMPT are imported
// from ../shared/prompts.js — the same module api/_claudeHandler.js
// imports, so the server (which now owns actually building these prompts,
// see that file) and this bundle's "Build Your Own G.I.S.T." blueprint
// display below can never drift apart.

// The "Build Your Own G.I.S.T." blueprint handed to a teacher's AI
// assistant (see BuildYourOwnScreen). Deliberately built as a template
// literal that interpolates the app's real, live prompt constants
// imported above rather than a second, hand-copied wall of text — this
// can't silently drift out of date if a prompt is ever tuned again, since
// it's reading the same constants the server actually uses.
const BUILD_YOUR_OWN_PROMPT = `You're going to help me adapt an existing AI teaching tool called G.I.S.T. (Guided Inference Skill Trainer) for my own class. Below is its complete design: what it does, how it's built, the exact prompts it sends to its AI, and the reasoning behind its trickier design decisions. Please read all of it, then help me build my own adapted version — ask me what I'd like to change before you start.

=== WHAT G.I.S.T. IS ===

G.I.S.T. is an AI vocabulary and reading-comprehension coach for Malaysian primary school (Year 4-6) ESL students. It does not hand a student a definition. It walks them through the skill a strong reader actually uses on an unfamiliar word: read the sentence around it, notice a clue, work the meaning out for yourself. A student picks a passage, works through a handful of target words with an AI coach that escalates through five adaptive stages of difficulty per word, then a separate AI reads back over the whole finished session and writes a plain-language diagnostic report for the teacher — not a score, a specific evidence-backed picture of where the student's understanding is solid and where it isn't.

=== ARCHITECTURE ===

- Frontend: a single React 18 + Vite single-page app.
- Backend: Vercel serverless functions acting as a thin, protected proxy in front of an AI provider (Groq's free tier in the original) — the browser never holds an AI API key directly.
- Database: Supabase (Postgres) for student accounts and session history.
- Auth model: one shared access code per school or class, not per-teacher or per-student accounts — whoever has the code can use the app on a device until the code's session expires. Students then sign up once with their name and a 3-animal "secret" (not a real password, deliberately kid-simple), kept separate from the animal companion shown on screen so a classmate can't read it off the screen during play.
- Cost control: every AI call is metered against a small daily quota per access code, and session word counts are fixed rather than open-ended, specifically to keep AI spend predictable on a free tier.

=== THE ACTUAL AI PROMPTS ===

These are copied verbatim from the real, currently-running app — not paraphrased. There are several distinct AI jobs, not one repeated chatbot call:

--- THE COACH (one call per turn, escalates through up to 5 stages per word) ---
Example instantiation (the real prompt is generated per-word with the word's specific stage-type cycle baked in):
${buildCoachSystemPrompt("parrot", "mcq", "word_bank", "tap_select")}

--- THE TRANSFER TEST (checks the word sticks outside the original sentence) ---
${TRANSFER_TEST_SYSTEM_PROMPT}

--- THE COMPREHENSION CHECK (whole-passage understanding, not per-word) ---
${COMPREHENSION_SYSTEM_PROMPT}

--- THE LEVEL MAKER (turns a teacher's own pasted passage into a lesson) ---
${LEVEL_MAKER_SYSTEM_PROMPT(SESSION_WORD_COUNT)}

--- SINGLE-WORD REGENERATION (lets a teacher swap out one word the maker picked) ---
${SINGLE_WORD_REGEN_PROMPT}

--- THE DIAGNOSTIC ENGINE (reads the whole finished session, writes the teacher's report) ---
${DIAGNOSTIC_SYSTEM_PROMPT}

=== THE DESIGN RULES BEHIND THESE PROMPTS (please preserve the reasoning, not just the words) ===

- The coach is under a hard instruction to NEVER state the word's dictionary definition directly — the entire point is inference practice, not a look-up tool. If you change the subject or age group, keep this constraint.
- Multiple-choice, true/false, tap-the-mistake, and similar "structured" answer types are checked deterministically by the app's own code, NOT trusted to the AI's judgment — the AI only free-judges answers where there genuinely is no fixed answer key (typed sentences). This exists because an AI grading its own multiple-choice question can be subtly inconsistent; a plain equality check can't.
- The diagnostic engine is a completely separate AI call from the coach, run only once at the end of a session, reading a structured log rather than the raw conversation — this keeps the report's judgment independent of whatever tone the coach happened to take mid-session.
- There's a deliberate minimum pacing delay before a student can submit an answer, and the app tracks whether an answer landed suspiciously close to that floor — a signal for "this was a guess," fed into the diagnostic report as evidence, not a hard block.
- Every report claim names the specific word and evidence behind it. It never predicts future performance, never suggests reteaching, and always ends in one real, specific next classroom action — it's built to be an assessment tool, not a re-teaching tool, so the teacher stays in control of what happens next.

=== NOW, PLEASE ADAPT THIS FOR ME ===

I'd like your help building my own version. Some directions this could go (tell me which apply, or suggest your own):
- A different age group or proficiency level than Year 4-6 ESL.
- A different primary language emphasis (e.g. leaning more into Bahasa Malaysia, or a different second language entirely).
- A different subject than vocabulary/reading — the same "escalating Socratic coach + separate diagnostic report" pattern could fit other skills.
- More or fewer target words per session than the original's 5.
- A different visual theme or mascot/companion set than the original's animal companions.

Ask me what I want before generating anything, and please keep the same overall shape (a coach that never just gives the answer, a report that always cites evidence and ends in a real action) even as the specifics change.`;

/* ---------------- Access gate (auth) ---------------- */
// Lightweight module-level bridge between the App component's auth state
// and callClaude(), which is a plain function outside React so it can't
// read hooks directly. App() keeps these in sync via useEffect.
const AUTH_STORAGE_KEY = "gist_auth";
let currentAuthToken = null;
let onAuthInvalidated = null;

function loadCachedAuth() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.expiresAt || parsed.expiresAt < Date.now()) {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveCachedAuth(token, expiresAt) {
  try {
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, expiresAt }));
  } catch (e) {
    /* sessionStorage unavailable (e.g. private browsing); token just won't persist across reloads */
  }
}

function clearCachedAuth() {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
}

/* ---------------- Student accounts (auth) ---------------- */
// Same bridge pattern as the teacher access-token above, but for the
// signed-in student (full name + 3-animal secret, see api/_studentAuth.js).
// Separate token/storage from the teacher token: the teacher token proves
// "this device is unlocked for School X," the student token additionally
// proves "and this is specifically Ahmad," needed to save a session under
// the right student_id.
const STUDENT_AUTH_STORAGE_KEY = "gist_student_auth";
let currentStudentToken = null;

function loadCachedStudentAuth() {
  try {
    const raw = sessionStorage.getItem(STUDENT_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.expiresAt || parsed.expiresAt < Date.now() || !parsed?.student) {
      sessionStorage.removeItem(STUDENT_AUTH_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveCachedStudentAuth(token, expiresAt, student) {
  try {
    sessionStorage.setItem(STUDENT_AUTH_STORAGE_KEY, JSON.stringify({ token, expiresAt, student }));
  } catch (e) {
    /* sessionStorage unavailable; token just won't persist across reloads */
  }
}

function clearCachedStudentAuth() {
  try {
    sessionStorage.removeItem(STUDENT_AUTH_STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
}

/* ---------------- Quota tracking (client-side, per-device estimate) ---------------- */
// The real quota is enforced server-side (api/_claudeHandler.js) no
// matter what this cache says — this exists only to drive a "X of Y
// used today" indicator and to block starting a new session when there
// isn't enough budget left to finish one. It's a same-device estimate,
// not a global count: Vercel's serverless functions don't share memory
// across invocations, so there's no way to ask the server "what's the
// real total" without that ask itself costing a real call. Seeded from
// dailyLimit on /api/auth, corrected by the authoritative numbers in
// every /api/claude response after that.
const QUOTA_STORAGE_KEY = "gist_quota";
const quotaListeners = new Set();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadQuotaCache() {
  try {
    const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.date !== todayKey()) return null; // new day, stale
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveQuotaCache(fields) {
  try {
    const existing = loadQuotaCache() || { used: 0, limit: null };
    const merged = { date: todayKey(), used: existing.used, limit: existing.limit, ...fields };
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(merged));
    quotaListeners.forEach((fn) => fn(merged));
  } catch (e) {
    /* localStorage unavailable (e.g. private browsing); indicator just won't persist */
  }
}

function useQuotaStatus() {
  const [status, setStatus] = useState(() => loadQuotaCache());
  useEffect(() => {
    quotaListeners.add(setStatus);
    return () => quotaListeners.delete(setStatus);
  }, []);
  return status; // null (unknown yet) | { date, used, limit }
}

/* ---------------- API helper ---------------- */
// promptId + params (rather than a built system-prompt string) is what
// actually goes over the wire — the server owns building the real prompt
// from these (see api/_claudeHandler.js's PROMPT_BUILDERS), so there's no
// way for anything calling this endpoint directly (bypassing this app
// entirely) to smuggle arbitrary instruction text into what gets sent to
// the AI provider under this app's key and quota. `params` is null for
// every prompt except "coach", which needs { companionId, stage1Type,
// stage2Type, stage3Type }.
async function callClaude(promptId, params, messages, maxTokens = 1000) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(currentAuthToken ? { Authorization: `Bearer ${currentAuthToken}` } : {}),
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      promptId,
      ...(params ? { params } : {}),
      messages,
    }),
  });
  if (response.status === 401) onAuthInvalidated?.();
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (data?.quota) saveQuotaCache({ used: data.quota.used, limit: data.quota.limit });
    const err = new Error(
      response.status === 401
        ? "Access code session expired, please re-enter your code"
        : data?.error || "API request failed"
    );
    err.status = response.status;
    // Distinguishes a short-lived 429 (our own per-IP throttle, or Groq's
    // own per-minute rate limit — both clear within seconds) from the
    // daily-quota-exhausted 429 (won't clear until tomorrow, no point
    // retrying) — see the matching comments in api/_claudeHandler.js.
    err.retryable = data?.retryable === true;
    // The exact wait Groq says is actually needed (see the matching
    // comment in api/_claudeHandler.js), when it sent one — lets
    // callClaudeWithRetry wait exactly that long instead of a fixed
    // guess that can be shorter than what's really required.
    err.retryAfterMs = typeof data?.retryAfterMs === "number" ? data.retryAfterMs : null;
    throw err;
  }
  const data = await response.json();
  if (data?.quota) saveQuotaCache({ used: data.quota.used, limit: data.quota.limit });
  const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
  return textBlocks.join("");
}

// Shared fetch wrapper for the student-account endpoints (student-auth,
// session, teacher-roster). `token` is whichever bearer token the call
// needs (teacher or student, callers pass the right one explicitly since
// unlike callClaude these aren't all teacher-scoped).
async function apiRequest(path, { method = "GET", body, token } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  // Only the teacher access-code token actually being invalid/expired
  // should trigger the "class session timed out" re-auth overlay (see
  // onAuthInvalidated in App) — callClaude already does this for AI
  // calls, but File Box/session/roster calls through this helper were
  // missing it, silently showing a generic "couldn't load" error with no
  // way back in. The tricky part: /api/student-auth returns a 401 for
  // TWO different reasons (the caller's own teacher token being bad, or a
  // student simply mistyping their name/secret animals), and both cases
  // send the exact same teacher token — student signup/login has no
  // student token yet to distinguish them by. Comparing token identity
  // alone can't tell these apart (it's the same token either way), so
  // this relies on the server's own explicit `tokenInvalid` flag (see the
  // matching comment in api/_studentAuthHandler.js) instead of guessing
  // from status code + token identity — a student's wrong-secret 401
  // never sets that flag, so it correctly never pops this overlay.
  if (response.status === 401 && data?.tokenInvalid && token && token === currentAuthToken) onAuthInvalidated?.();
  if (!response.ok) {
    const err = new Error(data?.error || "Request failed");
    err.status = response.status;
    throw err;
  }
  return data;
}

// Return the raw {token, expiresAt, student} rather than persisting it
// here, same shape as AccessGateScreen's onUnlocked(token, expiresAt):
// the caller (App's onStudentAuthenticated) is what updates React state
// and sessionStorage together, so currentStudentToken only ever changes
// via the same effect-driven path studentAuth already uses, never a
// side channel that state could later stomp back to stale.
async function studentSignup(fullName, secretSequence, avatarConfig) {
  const data = await apiRequest("/api/student-auth", {
    method: "POST",
    token: currentAuthToken,
    body: { mode: "signup", fullName, secret: secretSequence, avatarConfig },
  });
  return data;
}

async function studentLogin(fullName, secretSequence) {
  const data = await apiRequest("/api/student-auth", {
    method: "POST",
    token: currentAuthToken,
    body: { mode: "login", fullName, secret: secretSequence },
  });
  return data;
}

// Teacher-mediated recovery for a student who forgot their secret
// animals: the teacher picks the roster row and sets a new sequence with
// the student right there, no email/identity-verification flow needed
// since the teacher's own token is already the authorization.
async function resetStudentSecret(studentId, secretSequence) {
  return apiRequest("/api/student-auth", {
    method: "POST",
    token: currentAuthToken,
    body: { mode: "reset", studentId, secret: secretSequence },
  });
}

async function saveSession(payload) {
  return apiRequest("/api/session", { method: "POST", token: currentStudentToken, body: payload });
}

// classId: omit for the whole roster, a class id string to scope to that
// class, or "none" (the server's sentinel, see _teacherRosterHandler.js)
// for students not currently assigned to any class.
async function fetchTeacherRoster(classId) {
  const qs = classId ? `?classId=${encodeURIComponent(classId)}` : "";
  return apiRequest(`/api/teacher-roster${qs}`, { token: currentAuthToken });
}

async function createClass(name) {
  return apiRequest("/api/teacher-roster", { method: "POST", token: currentAuthToken, body: { name } });
}

async function renameClass(classId, name) {
  return apiRequest("/api/teacher-roster", { method: "PATCH", token: currentAuthToken, body: { kind: "renameClass", classId, name } });
}

// classId is a class's id string, or null to move the student back to
// "Unassigned".
async function assignStudentToClass(studentId, classId) {
  return apiRequest("/api/teacher-roster", { method: "PATCH", token: currentAuthToken, body: { kind: "assignStudent", studentId, classId } });
}

// Deleting a class never deletes its students — the server unassigns them
// back to "Unassigned" instead (ON DELETE SET NULL, see schema.sql).
async function deleteClass(classId) {
  return apiRequest(`/api/teacher-roster?classId=${encodeURIComponent(classId)}`, { method: "DELETE", token: currentAuthToken });
}

async function fetchStudentSessions(studentId) {
  return apiRequest(`/api/teacher-roster?studentId=${encodeURIComponent(studentId)}`, { token: currentAuthToken });
}

async function fetchSessionDetail(sessionId) {
  return apiRequest(`/api/session?sessionId=${encodeURIComponent(sessionId)}`, { token: currentAuthToken });
}

async function cacheSessionDiagnostic(sessionId, diagnosticReport) {
  return apiRequest("/api/session", { method: "PATCH", token: currentAuthToken, body: { sessionId, diagnosticReport } });
}

// Permanently deletes one session (and its word log, via the DB's own
// cascade) — for a teacher pruning a single bad/test session without
// touching the rest of that student's history.
async function deleteSession(sessionId) {
  return apiRequest(`/api/session?sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE", token: currentAuthToken });
}

// Permanently deletes a whole student account and every one of their
// sessions (cascade) — for a teacher wiping out a test/duplicate roster
// entry entirely, not just one session under it.
async function deleteStudentAccount(studentId) {
  return apiRequest(`/api/teacher-roster?studentId=${encodeURIComponent(studentId)}`, { method: "DELETE", token: currentAuthToken });
}

// Failures the server can't resolve by simply being asked again: retrying
// just delays showing the real message (or, for 401, spams /api/claude
// with an already-invalidated token). Only network hiccups and malformed
// JSON responses are worth a retry — 429 is a special case, see
// RETRYABLE_WAIT_MS below: most 429s land here too (daily quota
// exhausted, won't clear until tomorrow), but a short-lived one (our own
// per-IP throttle, or Groq's own per-minute rate limit) is carved out via
// the `retryable` flag rather than being lumped in with the rest.
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 429]);
// A rate-limited 429 clears within its rolling window (Groq's own error
// message for this typically cites single-digit-to-tens of seconds), not
// instantly — the default backoff below (a few hundred ms) is tuned for
// transient network/parse hiccups, not this, so a retryable 429
// specifically waits this much longer before the next attempt.
const RETRYABLE_429_WAIT_MS = 20_000;

function safeParseJSON(raw) {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  // Groq's gpt-oss reasoning models are requested with include_reasoning:
  // false (see api/_claudeHandler.js), which normally keeps reasoning out
  // of this content entirely — but there are live community reports of a
  // <think>...</think>-style reasoning block still leaking into content
  // regardless of that setting. Strip it defensively before parsing;
  // harmless no-op for every other response, which never contains this.
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Attempt 1: parse as-is
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    /* fall through */
  }

  // Attempt 2: extract the outermost {...} block in case of stray prose before/after
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const slice = cleaned.slice(first, last + 1);
    try {
      return JSON.parse(slice);
    } catch (e) {
      /* fall through */
    }
    // Attempt 3: escape stray literal newlines/tabs sitting inside string values
    try {
      const repaired = slice.replace(/"((?:[^"\\]|\\.)*)"/g, (m, inner) =>
        `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "").replace(/\t/g, "\\t")}"`
      );
      return JSON.parse(repaired);
    } catch (e) {
      /* fall through */
    }
  }
  return null;
}

// Coach-only response shape check. A smaller model can return syntactically
// valid JSON that's still unusable (wrong/misspelled input_type, missing
// options for a type that needs them, a correct_answer that isn't even one
// of its own options) — previously that shape silently reached the render,
// which matches none of the answer-widget conditions, so the student saw no
// way to answer at all. Treating an invalid shape the same as invalid JSON
// (retry, don't render) catches that before it reaches the screen.
const COACH_INPUT_TYPES = new Set(["mcq", "true_false", "tap_select", "word_bank", "letter_connect", "reverse_clue", "text"]);
const COACH_TYPES_NEEDING_OPTIONS = new Set(["mcq", "true_false", "tap_select", "reverse_clue"]);
const COACH_TYPES_NEEDING_TILES = new Set(["word_bank", "letter_connect"]);

// Deterministic backstop for the prompt's own LANGUAGE RULES (see
// buildCoachSystemPrompt) -- a model that ignores the wording and writes
// a wall of text, a run-on sentence, a "nevertheless," or a long MCQ
// phrase gets rejected and retried here instead of silently shipping
// content the target 9-12-year-old ESL reader can't parse.
const HARD_CONNECTOR_RE = /\b(although|nevertheless|consequently)\b/i;
const MESSAGE_MAX_SENTENCES = 3;
const MESSAGE_MAX_WORDS_PER_SENTENCE = 12;
const MCQ_OPTION_MAX_WORDS = 5;

function wordCount(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

function messageSentences(message) {
  return String(message).split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
}

// Loose inflection strip (plural/tense endings) so "resilient" also catches
// a lazily-inflected "resiliently"-style variant used as a distractor.
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

// word_bank/letter_connect tiles should be exactly the target word's own
// letters, shuffled — compares the sorted letter multiset, not the order.
function tilesMatchWord(tiles, targetWord) {
  if (!Array.isArray(tiles) || !targetWord) return false;
  const tileLetters = tiles.map((t) => String(t).toLowerCase().trim()).filter(Boolean).sort().join("");
  const wordLetters = String(targetWord).toLowerCase().replace(/[^a-z]/g, "").split("").sort().join("");
  return !!wordLetters && tileLetters === wordLetters;
}

function stripPunctForCompare(s) {
  return String(s).toLowerCase().replace(/[.,!?;:"'()]/g, "").trim();
}

// tap_select/reverse_clue options are supposed to be display_sentence's own
// words, split individually — confirms an option isn't a hallucinated token
// that never actually appeared in the sentence.
function optionInSentence(option, sentence) {
  const cleanOption = stripPunctForCompare(option);
  if (!cleanOption) return false;
  const sentenceWords = stripPunctForCompare(sentence).split(/\s+/);
  return sentenceWords.includes(cleanOption);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Loose check for whether a free-typed "text" answer uses the target word in
// some recognizable form. Deliberately permissive (a stem match, not a full
// inflection list) — this only exists to catch the word being fully absent,
// so it should never false-flag a real inflection as "missing." Word-boundary
// anchored so a short stem can't match inside an unrelated longer word (e.g.
// target "damp"'s old 3-char stem "dam" used to match inside "Adam" — \b
// only allows a match that starts a word, like "dampened"). Short words
// (<=5 letters) use the whole word as the stem rather than truncating it
// further, since there's too little left to anchor on otherwise.
function textLikelyContainsWord(text, targetWord) {
  if (!text || !targetWord) return false;
  const t = String(text).toLowerCase();
  const w = String(targetWord).toLowerCase().trim();
  if (!w) return false;
  const stemLen = w.length <= 5 ? w.length : w.length - 2;
  const stem = w.slice(0, stemLen);
  if (!stem) return false;
  return new RegExp(`\\b${escapeRegex(stem)}`).test(t);
}

function validateCoachResponse(parsed, targetWordText) {
  if (!parsed || typeof parsed.message !== "string" || !parsed.message.trim()) return false;
  if (typeof parsed.display_sentence !== "string" || !parsed.display_sentence.trim()) return false;
  if (!COACH_INPUT_TYPES.has(parsed.input_type)) return false;
  if (typeof parsed.stage !== "number" || parsed.stage < 1 || parsed.stage > 5) return false;
  if (COACH_TYPES_NEEDING_OPTIONS.has(parsed.input_type)) {
    if (!Array.isArray(parsed.options) || parsed.options.length < 2) return false;
    if (parsed.input_type === "true_false" && parsed.options.length !== 2) return false;
    if ((parsed.input_type === "tap_select" || parsed.input_type === "reverse_clue") && (parsed.options.length < 3 || parsed.options.length > 6)) return false;
    if (typeof parsed.correct_answer !== "string" || !parsed.options.includes(parsed.correct_answer)) return false;
  }
  if (COACH_TYPES_NEEDING_TILES.has(parsed.input_type) && (!Array.isArray(parsed.word_tiles) || parsed.word_tiles.length === 0)) {
    return false;
  }
  // true_false must pose a statement to judge, not a question — a question
  // with True/False buttons under it gives the student nothing to judge.
  if (parsed.input_type === "true_false" && /\?\s*$/.test(parsed.message.trim())) return false;
  // LANGUAGE RULES backstop: no hard connectors, message capped at 3 short
  // sentences (each capped at 12 words), MCQ options capped at 5 words —
  // see HARD_CONNECTOR_RE etc. above.
  if (HARD_CONNECTOR_RE.test(parsed.message)) return false;
  const msgSentences = messageSentences(parsed.message);
  if (msgSentences.length > MESSAGE_MAX_SENTENCES) return false;
  if (msgSentences.some((s) => wordCount(s) > MESSAGE_MAX_WORDS_PER_SENTENCE)) return false;
  if (parsed.input_type === "mcq" && Array.isArray(parsed.options)) {
    if (parsed.options.some((opt) => wordCount(opt) > MCQ_OPTION_MAX_WORDS)) return false;
  }
  if (!targetWordText) return true; // no target word available to check content against

  // Content checks: the shape can be perfectly valid JSON while still being
  // semantically wrong (the target word offered as its own MCQ answer, a
  // padded/hallucinated letter bank, a tap target that isn't really in the
  // sentence) — none of that is caught by the shape checks above.
  if (parsed.input_type === "mcq" && Array.isArray(parsed.options)) {
    if (parsed.options.some((opt) => isTargetWordMatch(opt, targetWordText))) return false;
  }
  if (COACH_TYPES_NEEDING_TILES.has(parsed.input_type) && !tilesMatchWord(parsed.word_tiles, targetWordText)) {
    return false;
  }
  if ((parsed.input_type === "tap_select" || parsed.input_type === "reverse_clue") && Array.isArray(parsed.options)) {
    if (!parsed.options.every((opt) => optionInSentence(opt, parsed.display_sentence))) return false;
  }
  return true;
}

async function callClaudeWithRetry(promptId, params, messages, attempts = MAX_RETRY_ATTEMPTS, validate = null, maxTokens = 1000) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    let wasRetryable429 = false;
    try {
      const raw = await callClaude(promptId, params, messages, maxTokens);
      const parsed = safeParseJSON(raw);
      if (parsed && (!validate || validate(parsed))) return parsed;
      lastError = new Error(parsed ? "Response didn't match the expected shape" : "Response wasn't valid JSON");
    } catch (e) {
      lastError = e;
      wasRetryable429 = e.status === 429 && e.retryable;
      if (NON_RETRYABLE_STATUSES.has(e.status) && !wasRetryable429) break;
    }
    if (i < attempts - 1) {
      // Prefer the exact wait Groq told us was needed (see retryAfterMs
      // in callClaude) over the fixed guess below — retrying earlier than
      // the real ceiling just fails again for the same reason, seen live
      // on a heavier call (the diagnostic report) whose actual required
      // wait exceeded the fixed constant. +500ms covers round-trip/clock
      // slack rather than retrying at the exact reported instant. Only
      // fall back to the fixed guess when Groq gave no specific number —
      // flooring at the fixed wait even when the real one is shorter would
      // just be needlessly slow.
      const retryDelay = wasRetryable429
        ? (lastError.retryAfterMs != null ? lastError.retryAfterMs + 500 : RETRYABLE_429_WAIT_MS)
        : 400 * (i + 1);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  throw lastError || new Error("Couldn't get a response, please try again");
}


/* ---------------- UI atoms ---------------- */
const BigButton = React.forwardRef(({ children, onClick, disabled, variant = "solid", className = "", silent = false }, ref) => {
  const base = "font-display font-800 text-sm px-6 py-3 rounded-full transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-1 active:scale-95";
  const variantStyles = {
    solid: { background: "linear-gradient(180deg,#fbbf24,#d97706)", color: "white", boxShadow: "0 5px 0 0 #92400e" },
    outline: { background: "white", color: "#047857", border: "3px solid #34d399", boxShadow: "0 4px 0 0 #a7f3d0" },
    ghost: { background: "transparent", color: "#78716c", boxShadow: "none" },
  };
  return (
    <button
      ref={ref}
      onClick={(e) => { if (!silent) SFX.click(); if (onClick) onClick(e); }}
      disabled={disabled}
      className={`${base} ${className}`}
      style={disabled ? { ...variantStyles[variant], boxShadow: "none" } : variantStyles[variant]}
      onMouseDown={(e) => { if (!disabled && variant !== "ghost") e.currentTarget.style.boxShadow = "none"; }}
      onMouseUp={(e) => { if (!disabled && variant !== "ghost") e.currentTarget.style.boxShadow = variantStyles[variant].boxShadow; }}
      onMouseLeave={(e) => { if (!disabled && variant !== "ghost") e.currentTarget.style.boxShadow = variantStyles[variant].boxShadow; }}
    >
      {children}
    </button>
  );
});

const AvatarBadge = ({ config, size = "w-14 h-14", pixelSize = 56 }) => (
  <div className={size}>
    <AvatarDisplay config={config} size={pixelSize} />
  </div>
);

function MakerResultSkeleton() {
  const bar = (widthClass, toneClass) => <div className={`h-3 ${widthClass} ${toneClass} rounded-full animate-pulse`} />;
  const chip = (widthClass) => <div className={`h-7 ${widthClass} bg-teal-200/50 rounded-full animate-pulse`} />;
  return (
    <div className="mb-4 p-4 rounded-2xl bg-teal-50 step-in" style={{ border: "2px solid #0d9488" }} aria-hidden="true">
      <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl" style={{ background: "#f5f5f4", border: "2px solid #d6d3d1" }}>
        <div className="w-6 h-6 rounded-full bg-stone-300/60 animate-pulse" />
        <div className="space-y-1.5 flex-1">
          {bar("w-32", "bg-stone-300/60")}
          {bar("w-48", "bg-stone-300/40")}
        </div>
      </div>
      <div className="space-y-1.5 mb-2">{bar("w-full", "bg-teal-300/40")}</div>
      <div className="space-y-1.5 mb-3">{bar("w-4/5", "bg-teal-300/40")}</div>
      {bar("w-28", "bg-teal-400/50")}
      <div className="flex flex-wrap gap-2 mt-2">
        {chip("w-20")}
        {chip("w-24")}
        {chip("w-16")}
      </div>
    </div>
  );
}

// Must match SECRET_LENGTH in api/_studentAuth.js.
const SECRET_LENGTH = 3;

// Controlled 3-tap animal sequence picker: used both to CHOOSE a new
// secret at signup and to RE-ENTER an existing one at login (the tap
// interaction is identical either way; the copy around it, handled by
// the caller, is what differs). Deliberately a separate pool of taps
// from CompanionGrid's coach-companion picker below, even though it
// draws on the same ANIMAL_COMPANIONS list — the point is this choice
// never appears on screen again after signup, unlike the visible coach
// companion, so a classmate who's watched someone play can't just read
// their password off the screen.
function SecretAnimalPicker({ value, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-2.5 mb-4">
        {Array.from({ length: SECRET_LENGTH }).map((_, i) => {
          const filled = value[i];
          const animal = filled ? ANIMAL_COMPANIONS.find((a) => a.id === filled) : null;
          return (
            <div
              key={i}
              className="w-14 h-14 rounded-full flex items-center justify-center text-2xl bg-white"
              style={{ border: animal ? "3px solid #0d9488" : "3px dashed #d6d3d1" }}
            >
              {animal ? animal.emoji : <span className="text-stone-300 text-xl">?</span>}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {ANIMAL_COMPANIONS.map((a) => (
          <button
            key={a.id}
            onClick={() => { if (value.length < SECRET_LENGTH) { SFX.tap(); onChange([...value, a.id]); } }}
            disabled={value.length >= SECRET_LENGTH}
            className="flex flex-col items-center gap-0.5 p-2.5 rounded-2xl bg-white transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
            style={{ border: "3px solid #d6d3d1" }}
            aria-label={a.label}
          >
            <span className="text-2xl">{a.emoji}</span>
          </button>
        ))}
      </div>
      {value.length > 0 && (
        <div className="text-center mt-3">
          <button onClick={() => { SFX.click(); onChange([]); }} className="font-body text-xs text-stone-500 underline hover:text-stone-700">
            Start over
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Setup Screen ---------------- */
function SetupScreen({ onBegin, customPassages, onSaveCustomPassage, onViewDemoReport, bilingual, onToggleBilingual, onStudentAuthenticated, onOpenFileBox, onOpenTeacherGuide, onOpenBuildYourOwn }) {
  const [mode, setMode] = useState(null); // null (main menu) | "tour" | "play" | "maker"
  const [step, setStep] = useState(1);
  const [studentId, setStudentId] = useState("");
  const [avatarConfig, setAvatarConfig] = useState(DEFAULT_AVATAR_CONFIG);
  const [passageId, setPassageId] = useState(null);
  // Where the tour should send the student when they finish it: into the
  // name/avatar/passage wizard right after "Start Playing" (first-time
  // flow), or back to the main menu (a returning student replaying it on
  // demand from "How to play"). Tracked separately from `mode` since both
  // entry points land on the same mode === "tour" screen.
  const [afterTour, setAfterTour] = useState("wizard");

  // New/returning student sign-up and login (mode === "student-choice" |
  // "student-signup" | "student-login"). A new student's chosen secret is
  // carried forward (not submitted yet) through the tutorial and the
  // avatar-builder wizard steps, since the account is only actually
  // created once the whole avatarConfig is assembled, at the final
  // "Start my adventure" confirm — pendingSignup marks that a signup
  // call is still owed at that point, vs. a returning student who's
  // already authenticated and just needs onBegin().
  const [authName, setAuthName] = useState("");
  const [authSecret, setAuthSecret] = useState([]);
  const [pendingSignup, setPendingSignup] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Unknown status (null, e.g. localStorage unavailable) fails open:
  // better to let a session start than block on missing information we
  // have no way to obtain otherwise.
  const quotaStatus = useQuotaStatus();
  const canAffordSession =
    !quotaStatus || quotaStatus.limit == null || quotaStatus.limit - quotaStatus.used >= SESSION_COST_ESTIMATE;

  const [makerText, setMakerText] = useState("");
  const [makerTitle, setMakerTitle] = useState("");
  const [makerResult, setMakerResult] = useState(null); // { emoji, mission, arrival, words, readabilityLevel, readabilityNote }
  const [makerGenerating, setMakerGenerating] = useState(false);
  const [makerError, setMakerError] = useState(null);
  const [makerSaved, setMakerSaved] = useState(false);
  const [makerWords, setMakerWords] = useState(() => Array(SESSION_WORD_COUNT).fill(""));
  const [regeneratingIndex, setRegeneratingIndex] = useState(null);

  const allPassages = { ...PASSAGES, ...Object.fromEntries(customPassages.map((p) => [p.id, p])) };

  async function generateMakerLevel() {
    if (!makerText.trim()) return;
    SFX.click();
    setMakerGenerating(true);
    setMakerError(null);
    setMakerResult(null);
    const chosenWords = makerWords.map((w) => w.trim()).filter(Boolean);
    const userContent = chosenWords.length
      ? `${makerText.trim()}\n\nRequired words: use exactly these words for the target list, in this order, spelled exactly as I've written them here: ${chosenWords.join(", ")}. If fewer than ${SESSION_WORD_COUNT} are given, pick your own good words to fill the remaining slots.`
      : makerText.trim();
    try {
      const parsed = await callClaudeWithRetry(
        "level_maker",
        null,
        [{ role: "user", content: userContent }],
        MAX_RETRY_ATTEMPTS,
        (p) => p && Array.isArray(p.words) && p.words.length === SESSION_WORD_COUNT
      );
      const validated = parsed.words.map((w) => ({
        ...w,
        foundInText: makerText.toLowerCase().includes(String(w.word || "").toLowerCase()),
      }));
      setMakerResult({
        emoji: parsed.emoji || "📖",
        mission: parsed.mission || "",
        arrival: parsed.arrival || "",
        readabilityLevel: parsed.readabilityLevel || null,
        readabilityNote: parsed.readabilityNote || "",
        words: validated,
      });
    } catch (e) {
      setMakerError(`Couldn't generate the map just now. ${e.message || ""} Try again.`);
    }
    setMakerGenerating(false);
  }

  async function regenerateSingleWord(index) {
    if (!makerResult) return;
    SFX.tap();
    setRegeneratingIndex(index);
    const otherWords = makerResult.words.filter((_, i) => i !== index).map((w) => w.word);
    try {
      const raw = await callClaude("single_word_regen", null, [
        { role: "user", content: `Passage: "${makerText.trim()}"\n\nAlready chosen words (don't repeat these): ${otherWords.join(", ")}` },
      ]);
      const parsed = safeParseJSON(raw);
      if (parsed && parsed.word) {
        const foundInText = makerText.toLowerCase().includes(String(parsed.word).toLowerCase());
        setMakerResult((prev) => ({
          ...prev,
          words: prev.words.map((w, i) => (i === index ? { ...parsed, foundInText } : w)),
        }));
      }
    } catch (e) {
      /* keep the existing word if this fails */
    }
    setRegeneratingIndex(null);
  }

  function saveMakerLevel() {
    if (!makerResult || !makerTitle.trim()) return;
    if (makerResult.words.some((w) => !w.foundInText)) return;
    SFX.tap();
    const id = "custom-" + makerTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) + "-" + Date.now().toString(36).slice(-4);
    const newPassage = {
      title: makerTitle.trim(),
      emoji: makerResult.emoji,
      mission: makerResult.mission,
      arrival: makerResult.arrival,
      text: makerText.trim(),
      words: makerResult.words.map(({ word, clueType, concreteness }) => ({ word, clueType, concreteness })),
    };
    onSaveCustomPassage(id, newPassage);
    setPassageId(id);
    setMakerText("");
    setMakerTitle("");
    setMakerResult(null);
    setMakerWords(Array(SESSION_WORD_COUNT).fill(""));
    setMakerSaved(true);
  }

  function resetMakerAndGoMenu() {
    setMode(null);
    setMakerSaved(false);
    setMakerText("");
    setMakerTitle("");
    setMakerResult(null);
    setMakerError(null);
  }

  const StepDots = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className={`h-2.5 rounded-full transition-all ${
            n === step ? "w-8 bg-orange-400" : n < step ? "w-2.5 bg-emerald-400" : "w-2.5 bg-stone-200"
          }`}
        />
      ))}
    </div>
  );

  const CompanionGrid = ({ selected, onSelect }) => (
    <div className="grid grid-cols-4 gap-2.5">
      {ANIMAL_COMPANIONS.map((a) => {
        const persona = COMPANION_PERSONAS[a.id];
        const isSelected = selected === a.id;
        const dotTexture = `radial-gradient(${persona?.color?.border}${isSelected ? "40" : "26"} 1.4px, transparent 1.4px)`;
        return (
          <button
            key={a.id}
            onClick={() => { SFX.tap(); onSelect(a.id); }}
            className={`flex flex-col items-center text-center gap-1 p-3 rounded-2xl transition-all ${
              isSelected ? "scale-[1.03]" : "hover:opacity-90"
            }`}
            style={{
              borderWidth: "3px",
              borderColor: persona?.color?.border,
              background: `${dotTexture}, ${isSelected ? persona?.color?.gradient : persona?.color?.soft}`,
              backgroundSize: "13px 13px, auto",
            }}
          >
            <span className="text-3xl shrink-0">{a.emoji}</span>
            <p className="font-display font-800 text-sm" style={{ color: persona?.color?.text }}>{persona?.name || a.label}</p>
            <p className="font-body text-[10px] leading-snug" style={{ color: persona?.color?.text }}>{persona?.description || a.label}</p>
          </button>
        );
      })}
    </div>
  );

  const Header = () => (
    <div className="text-center mb-4 relative z-10">
      <div className="flex justify-center mb-1"><CompassRose size={84} /></div>
      <h1 className="font-display text-7xl font-800 sticker-title mb-1">G.I.S.T.</h1>
      <p className="font-hand text-2xl text-amber-800 bg-white inline-block px-4 py-1 -rotate-2" style={{ borderRadius: "40px 8px 40px 8px", border: "2px solid #f59e0b" }}>chart your word-clue adventure!</p>
    </div>
  );

  const Footer = () => (
    <p className="font-body text-xs text-stone-500 text-center mt-8 leading-relaxed relative z-10 bg-white/70 rounded-xl py-2">
      For use during class or after-school sessions, with your teacher there to help. 🧑‍🏫
    </p>
  );

  /* -------- Main menu -------- */
  if (!mode) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 step-in min-h-screen flex flex-col justify-center relative">
        <FloatingDecor density={7} />
        <Header />
        <div className="relative z-10 bg-white p-2" style={{ ...CARD_GOLD, boxShadow: CARD_SHADOW_HERO }}>
          <div className="grid grid-cols-2">
            {/* Student panel */}
            <div className="p-8 flex flex-col items-center text-center rounded-2xl" style={{ background: "radial-gradient(#f59e0b26 1.4px, transparent 1.4px), #fffbeb", backgroundSize: "13px 13px, auto" }}>
              <p className="font-display font-800 text-sm uppercase tracking-wide text-amber-700 mb-2">For Students</p>
              <span className="text-5xl mb-3">🔍</span>
              <p className="font-body text-sm text-stone-600 leading-relaxed mb-5 max-w-[220px]">
                Choose a map and work through the words with your coach, tapping, spelling, and typing your way to each answer.
              </p>
              <BigButton onClick={() => { setAuthError(null); setMode("student-choice"); }}>
                <Play className="inline w-4 h-4 mr-1.5 fill-current" /> Start Playing
              </BigButton>
              <button
                onClick={() => { SFX.tap(); setAfterTour("menu"); setMode("tour"); }}
                className="mt-3 font-display font-700 text-xs text-amber-700 hover:text-amber-900 bg-white rounded-full px-3 py-1.5 border-2"
                style={{ borderColor: "#f59e0b" }}
              >
                ❓ How to play (see the tutorial again)
              </button>
            </div>

            {/* Divider */}
            <div className="absolute left-1/2 top-8 bottom-8 w-px bg-stone-200" />

            {/* Teacher panel */}
            <div className="p-8 flex flex-col items-center text-center rounded-2xl" style={{ background: "radial-gradient(#0d948826 1.4px, transparent 1.4px), #f0fdfa", backgroundSize: "13px 13px, auto" }}>
              <p className="font-display font-800 text-sm uppercase tracking-wide text-stone-600 mb-2">For Teachers</p>
              <span className="text-5xl mb-3">🧑‍🏫</span>
              <p className="font-body text-sm text-stone-600 leading-relaxed mb-5 max-w-[240px]">
                Paste any passage and G.I.S.T. picks the target words for you, ready in under a minute for your student to play.
              </p>
              <BigButton variant="outline" onClick={() => { setMode("maker"); setMakerSaved(false); }}>
                <Wrench className="inline w-4 h-4 mr-1.5" /> Create a Custom Map
              </BigButton>
              <div className="flex items-center gap-3 mt-3 flex-wrap justify-center">
                {onViewDemoReport && (
                  <button
                    onClick={() => { SFX.tap(); onViewDemoReport(); }}
                    className="font-display font-700 text-xs text-red-700 hover:text-red-900 bg-white rounded-full px-3 py-1.5 border-2"
                    style={{ borderColor: "#dc2626" }}
                  >
                    🔦 See a sample report
                  </button>
                )}
                {onOpenFileBox && (
                  <button
                    onClick={() => { SFX.tap(); onOpenFileBox(); }}
                    className="font-display font-700 text-xs text-blue-700 hover:text-blue-900 bg-white rounded-full px-3 py-1.5 border-2"
                    style={{ borderColor: "#2563eb" }}
                  >
                    🗃️ File Box
                  </button>
                )}
                {onOpenTeacherGuide && (
                  <button
                    onClick={() => { SFX.tap(); onOpenTeacherGuide(); }}
                    className="font-display font-700 text-xs text-teal-700 hover:text-teal-900 bg-white rounded-full px-3 py-1.5 border-2"
                    style={{ borderColor: "#0d9488" }}
                  >
                    ❓ How G.I.S.T. works
                  </button>
                )}
                {onOpenBuildYourOwn && (
                  <button
                    onClick={() => { SFX.tap(); onOpenBuildYourOwn(); }}
                    className="font-display font-700 text-xs text-violet-700 hover:text-violet-900 bg-white rounded-full px-3 py-1.5 border-2"
                    style={{ borderColor: "#7c3aed" }}
                  >
                    🧭 Build Your Own G.I.S.T.
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  /* -------- Level maker (reachable from menu, or from the map-picker step) -------- */
  if (mode === "maker") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8 step-in min-h-screen flex flex-col justify-center relative">
        <FloatingDecor density={7} />

        {makerSaved ? (
          <div className="bg-white p-8 step-in relative z-10 text-center" style={CARD_TEAL}>
            <p className="text-5xl mb-4">✅</p>
            <h1 className="font-display font-800 text-xl text-stone-700 block mb-2 text-center">Map saved!</h1>
            <p className="font-body text-sm text-stone-500 mb-6">It's ready for a student to play. Hand over the device and tap Start Playing.</p>
            <div className="flex items-center justify-center gap-3">
              <BigButton variant="ghost" onClick={resetMakerAndGoMenu}>
                <ChevronLeft className="inline w-4 h-4 mr-1" /> Main menu
              </BigButton>
              <BigButton onClick={() => { setMakerSaved(false); setAuthError(null); setMode("student-choice"); }}>
                <Play className="inline w-4 h-4 mr-1.5 fill-current" /> Start Playing <ArrowRight className="inline w-4 h-4 ml-1" />
              </BigButton>
            </div>
          </div>
        ) : (
          <div className="bg-white p-8 step-in relative z-10" style={CARD_TEAL}>
            <p className="text-4xl text-center mb-4">🛠️</p>
            <h1 className="font-display font-800 text-xl text-stone-700 block mb-2 text-center">Create your own map</h1>
            <p className="font-body text-xs text-stone-500 text-center mb-5">Paste a passage (about 80-150 words). The AI will pick {SESSION_WORD_COUNT} good target words with real context clues.</p>

            <label htmlFor="maker-title" className="font-display font-700 text-xs uppercase tracking-wide text-teal-700 block mb-2">Map title</label>
            <input
              id="maker-title"
              value={makerTitle}
              onChange={(e) => setMakerTitle(e.target.value)}
              placeholder="e.g. A Day at the Market"
              className="w-full bg-teal-50 rounded-2xl border-2 border-teal-300 px-4 py-3 font-body text-stone-700 mb-4 focus:outline-none focus:border-teal-500"
            />

            <label htmlFor="maker-text" className="font-display font-700 text-xs uppercase tracking-wide text-teal-700 block mb-2">Passage text</label>
            <textarea
              id="maker-text"
              value={makerText}
              onChange={(e) => setMakerText(e.target.value)}
              placeholder="Paste or write your passage here…"
              rows={6}
              className="w-full bg-teal-50 rounded-2xl border-2 border-teal-300 px-4 py-3 font-body text-sm text-stone-700 focus:outline-none focus:border-teal-500"
            />
            {(() => {
              const wc = makerText.trim() ? makerText.trim().split(/\s+/).length : 0;
              const good = wc >= 80 && wc <= 150;
              const color = wc === 0 ? "text-stone-500" : good ? "text-emerald-600" : "text-amber-600";
              return (
                <p className={`font-body text-[11px] mb-4 text-right ${color}`}>
                  {wc} word{wc === 1 ? "" : "s"} {wc > 0 && !good && (wc < 80 ? "· a bit short, aim for 80-150" : "· a bit long, aim for 80-150")}
                  {good && " · good length"}
                </p>
              );
            })()}

            <div className="flex items-center gap-3 mb-4 bg-teal-50 rounded-2xl px-4 py-3" style={{ border: "2px solid #0d9488" }}>
              <p className="font-display font-800 text-2xl text-teal-800">{SESSION_WORD_COUNT}</p>
              <div>
                <p className="font-display font-700 text-xs uppercase tracking-wide text-teal-700">Target Words</p>
                <p className="font-body text-[11px] text-stone-500">Fixed at {SESSION_WORD_COUNT} to keep each map's AI usage predictable</p>
              </div>
            </div>

            <label className="font-display font-700 text-xs uppercase tracking-wide text-teal-700 block mb-1">Words to highlight (optional)</label>
            <p className="font-body text-[11px] text-stone-500 mb-2">Pick specific words yourself, or leave any box blank and the AI will choose good ones for you.</p>
            <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: `repeat(${SESSION_WORD_COUNT}, minmax(0, 1fr))` }}>
              {makerWords.map((w, i) => (
                <input
                  key={i}
                  value={w}
                  onChange={(e) => setMakerWords((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                  placeholder={`Word ${i + 1}`}
                  aria-label={`Word ${i + 1} to highlight (optional)`}
                  className="w-full bg-teal-50 rounded-xl border-2 border-teal-300 px-2 py-2 font-body text-xs sm:text-sm text-stone-700 text-center focus:outline-none focus:border-teal-500"
                />
              ))}
            </div>

            <div className="text-center mb-4">
              <BigButton onClick={generateMakerLevel} disabled={!makerText.trim() || makerGenerating}>
                {makerGenerating ? "Reading your passage…" : "✨ Generate words & details"}
              </BigButton>
            </div>

            {makerError && <p className="font-body text-xs text-rose-600 text-center mb-4" aria-live="polite">{makerError}</p>}

            {makerGenerating && <MakerResultSkeleton />}

            {makerResult && (
              <div className="mb-4 p-4 rounded-2xl bg-teal-50 step-in" style={{ border: "2px solid #0d9488" }}>
                {makerResult.readabilityLevel && (
                  <div
                    className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl"
                    style={{
                      background: makerResult.readabilityLevel === "about_right" ? "#d1fae5" : "#fef3c7",
                      border: `2px solid ${makerResult.readabilityLevel === "about_right" ? "#059669" : "#d97706"}`,
                    }}
                  >
                    <span className="text-lg">{makerResult.readabilityLevel === "about_right" ? "✅" : makerResult.readabilityLevel === "too_easy" ? "🟢" : "🔴"}</span>
                    <div>
                      <p className="font-display font-800 text-xs uppercase tracking-wide text-stone-700">
                        {makerResult.readabilityLevel === "about_right" ? "Right for Year 4-6" : makerResult.readabilityLevel === "too_easy" ? "May be too easy" : "May be too hard"}
                      </p>
                      {makerResult.readabilityNote && <p className="font-body text-xs text-stone-600">{makerResult.readabilityNote}</p>}
                    </div>
                  </div>
                )}
                <p className="font-body text-xs text-stone-600 mb-2"><strong>Mission:</strong> {makerResult.mission}</p>
                <p className="font-body text-xs text-stone-600 mb-3"><strong>Arrival:</strong> {makerResult.arrival}</p>
                <p className="font-display font-700 text-xs uppercase tracking-wide text-teal-700 mb-2">{makerResult.words.length} target words</p>
                <div className="flex flex-wrap gap-2">
                  {makerResult.words.map((w, i) => (
                    <span
                      key={i}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-display font-700 text-xs ${w.foundInText ? "bg-white text-stone-700" : "bg-rose-100 text-rose-600"}`}
                      style={{ border: `2px solid ${w.foundInText ? "#0d9488" : "#e11d48"}` }}
                    >
                      <span title={w.foundInText ? `${w.clueType} · ${w.concreteness}` : "Not found in your passage text"}>
                        {regeneratingIndex === i ? "…" : w.word} {!w.foundInText && regeneratingIndex !== i && "⚠️"}
                      </span>
                      <button
                        onClick={() => regenerateSingleWord(i)}
                        disabled={regeneratingIndex !== null}
                        className="hover:scale-125 transition-all disabled:opacity-30"
                        title="Reroll just this word"
                      >
                        🔄
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-3 mt-6 flex-wrap">
              <BigButton
                variant="ghost"
                onClick={() => {
                  setMakerResult(null);
                  setMakerError(null);
                  setMode(null);
                }}
              >
                <ChevronLeft className="inline w-4 h-4 mr-1" /> Cancel
              </BigButton>
              {makerResult && (
                <BigButton variant="ghost" onClick={generateMakerLevel} disabled={makerGenerating}>
                  🔄 Regenerate
                </BigButton>
              )}
              <BigButton onClick={saveMakerLevel} disabled={!makerResult || !makerTitle.trim() || regeneratingIndex !== null || makerResult.words.some((w) => !w.foundInText)}>
                💾 Save map
              </BigButton>
            </div>
            {makerResult && makerResult.words.some((w) => !w.foundInText) && (
              <p className="font-body text-xs text-rose-600 text-center mt-2" aria-live="polite">
                ⚠️ Reroll the word{makerResult.words.filter((w) => !w.foundInText).length === 1 ? "" : "s"} marked in red before saving — a word that isn't in your passage text can never be found and tapped during play.
              </p>
            )}
          </div>
        )}
        <Footer />
      </div>
    );
  }

  /* -------- New vs returning student, right after "Start Playing" -------- */
  if (mode === "student-choice") {
    return (
      <div className="max-w-md mx-auto px-6 py-8 step-in min-h-screen flex flex-col justify-center relative">
        <FloatingDecor density={5} />
        <div className="bg-white p-8 step-in relative z-10 text-center" style={CARD_GOLD}>
          <p className="text-4xl mb-3">🧑‍🎓</p>
          <h1 className="font-display font-800 text-xl text-stone-700 mb-2">Who's playing?</h1>
          <p className="font-body text-sm text-stone-500 mb-6">This lets your teacher check your progress over time, not just today.</p>
          <div className="flex flex-col gap-3">
            <BigButton
              onClick={() => {
                SFX.tap();
                setAuthName("");
                setAuthSecret([]);
                setAuthError(null);
                setMode("student-signup");
              }}
            >
              🆕 New Student
            </BigButton>
            <BigButton
              variant="outline"
              onClick={() => {
                SFX.tap();
                setAuthName("");
                setAuthSecret([]);
                setAuthError(null);
                setMode("student-login");
              }}
            >
              ↩️ Returning Student
            </BigButton>
          </div>
          <button onClick={() => setMode(null)} className="mt-6 font-body text-xs text-stone-500 underline hover:text-stone-700">
            Back to menu
          </button>
        </div>
        <Footer />
      </div>
    );
  }

  /* -------- New student: name + secret (avatar collected later, in the
     wizard, so the account is created once with its real avatarConfig
     instead of a placeholder that would need a separate update call) -------- */
  if (mode === "student-signup") {
    const canContinue = authName.trim().length > 0 && authSecret.length === SECRET_LENGTH;
    return (
      <div className="max-w-md mx-auto px-6 py-8 step-in min-h-screen flex flex-col justify-center relative">
        <FloatingDecor density={5} />
        <div className="bg-white p-8 step-in relative z-10" style={CARD_GOLD}>
          <p className="text-4xl text-center mb-3">🆕</p>
          <h1 className="font-display font-800 text-xl text-stone-700 text-center mb-1">New Student</h1>
          <p className="font-body text-sm text-stone-500 text-center mb-5">
            Enter your full name, then pick 3 secret animals, in order. Remember them, you'll need them to log back in!
          </p>
          <input
            value={authName}
            onChange={(e) => setAuthName(e.target.value)}
            placeholder="Your full name"
            aria-label="Your full name"
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-amber-50 rounded-2xl border-2 border-amber-300 px-4 py-3.5 font-body text-lg text-stone-700 text-center focus:outline-none focus:border-amber-500 mb-5"
            autoFocus
          />
          <SecretAnimalPicker value={authSecret} onChange={setAuthSecret} />
          {authError && <p className="font-body text-xs text-rose-600 text-center mt-4" aria-live="polite">{authError}</p>}
          <div className="flex items-center justify-center gap-3 mt-6">
            <BigButton variant="ghost" onClick={() => setMode("student-choice")}>
              <ChevronLeft className="inline w-4 h-4 mr-1" /> Back
            </BigButton>
            <BigButton
              onClick={() => {
                if (!canContinue) return;
                SFX.click();
                setStudentId(authName.trim());
                setPendingSignup(true);
                setAfterTour("wizard");
                setMode("tour");
              }}
              disabled={!canContinue}
            >
              Continue <ArrowRight className="inline w-4 h-4 ml-1" />
            </BigButton>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  /* -------- Returning student: name + secret, verified immediately -------- */
  if (mode === "student-login") {
    const canSubmit = authName.trim().length > 0 && authSecret.length === SECRET_LENGTH;
    async function handleLogin() {
      if (!canSubmit) return;
      SFX.click();
      setAuthLoading(true);
      setAuthError(null);
      try {
        const data = await studentLogin(authName.trim(), authSecret);
        onStudentAuthenticated(data.token, data.expiresAt, data.student);
        setStudentId(data.student.fullName);
        setAvatarConfig(data.student.avatarConfig);
        setPendingSignup(false);
        setAuthSecret([]);
        setStep(3);
        setMode("play");
      } catch (e) {
        setAuthError(e.message || "Couldn't log in, please try again");
      } finally {
        setAuthLoading(false);
      }
    }
    return (
      <div className="max-w-md mx-auto px-6 py-8 step-in min-h-screen flex flex-col justify-center relative">
        <FloatingDecor density={5} />
        <div className="bg-white p-8 step-in relative z-10" style={CARD_GOLD}>
          <p className="text-4xl text-center mb-3">↩️</p>
          <h1 className="font-display font-800 text-xl text-stone-700 text-center mb-1">Returning Student</h1>
          <p className="font-body text-sm text-stone-500 text-center mb-5">Enter your full name and your 3 secret animals, in order.</p>
          <input
            value={authName}
            onChange={(e) => setAuthName(e.target.value)}
            placeholder="Your full name"
            aria-label="Your full name"
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-amber-50 rounded-2xl border-2 border-amber-300 px-4 py-3.5 font-body text-lg text-stone-700 text-center focus:outline-none focus:border-amber-500 mb-5"
            autoFocus
          />
          <SecretAnimalPicker value={authSecret} onChange={setAuthSecret} />
          {authError && <p className="font-body text-xs text-rose-600 text-center mt-4" aria-live="polite">{authError}</p>}
          <p className="font-body text-xs text-stone-400 text-center mt-4">
            Forgot your secret animals? Ask your teacher, they can reset it from the File Box.
          </p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <BigButton variant="ghost" onClick={() => setMode("student-choice")}>
              <ChevronLeft className="inline w-4 h-4 mr-1" /> Back
            </BigButton>
            <BigButton onClick={handleLogin} disabled={!canSubmit || authLoading}>
              {authLoading ? "Logging in…" : "Log in"} <ArrowRight className="inline w-4 h-4 ml-1" />
            </BigButton>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  /* -------- Tutorial: shown right after "Start Playing" (before the setup
     wizard), or on demand via "How to play" for a returning student -------- */
  if (mode === "tour") {
    return (
      <TourScreen
        avatarConfig={avatarConfig}
        passage={passageId ? allPassages[passageId] : null}
        onDone={() => (afterTour === "menu" ? setMode(null) : setMode("play"))}
        bilingual={bilingual}
        onToggleBilingual={onToggleBilingual}
        standalone={afterTour === "menu"}
      />
    );
  }

  /* -------- Play flow (4 steps) -------- */
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "100dvh" }}>
      <div className="max-w-5xl mx-auto w-full px-6 pt-7 pb-8 flex-1 flex flex-col min-h-0 step-in relative">
        <FloatingDecor density={7} />

        <StepDots />

        <div className="flex-1 min-h-0 flex flex-col justify-center">

      {step === 1 && (
        <div className="bg-white p-6 sm:p-8 step-in relative z-10" style={CARD_GOLD}>
          <div className="flex items-center gap-3 mb-5 bg-white rounded-2xl px-5 py-3" style={{ border: "2px solid #f59e0b" }}>
            <span className="text-3xl">🐾</span>
            <div>
              <h1 className="font-display font-800 text-xl text-stone-700 leading-tight">Pick your animal companion</h1>
              <p className="font-body text-xs text-stone-500">This animal will be your coach for the whole adventure</p>
            </div>
          </div>
          <CompanionGrid selected={avatarConfig.companion} onSelect={(id) => setAvatarConfig((c) => ({ ...c, companion: id }))} />
          <div className="flex items-center justify-center gap-3 mt-6">
            <BigButton variant="ghost" onClick={() => setMode(null)}>
              <ChevronLeft className="inline w-4 h-4 mr-1" /> Main menu
            </BigButton>
            <BigButton onClick={() => avatarConfig.companion && setStep(2)} disabled={!avatarConfig.companion}>
              Next <ArrowRight className="inline w-4 h-4 ml-1" />
            </BigButton>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="step-in relative z-10 max-h-full overflow-y-auto pb-3">
          <h1 className="font-display font-800 text-xl text-stone-700 block mb-3 text-center bg-white/70 rounded-xl py-1.5">Build your explorer</h1>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4" style={CARD_GOLD}>
              <div className="flex justify-center mb-3">
                <AvatarDisplay config={avatarConfig} size={80} />
              </div>

              <div className="mb-3">
                <p className="font-display font-700 text-sm uppercase tracking-wide text-amber-700 mb-2 text-center">Who are you?</p>
                <div className="flex gap-2 justify-center flex-wrap">
                  {AVATAR_HEADS.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => { SFX.tap(); setAvatarConfig((c) => ({ ...c, head: h.id })); }}
                      className={`w-11 h-11 rounded-full flex items-center justify-center text-xl border-3 transition-all ${
                        avatarConfig.head === h.id ? "border-amber-500 scale-110 bg-amber-50" : "border-stone-300 opacity-70"
                      }`}
                      style={{ borderWidth: "3px" }}
                      title={h.label}
                    >
                      {h.base + (avatarConfig.skinTone || "")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-display font-700 text-sm uppercase tracking-wide text-amber-700 mb-2 text-center">Skin tone</p>
                <div className="flex gap-2 justify-center flex-wrap">
                  {SKIN_TONES.map((tone) => {
                    const head = AVATAR_HEADS.find((h) => h.id === avatarConfig.head) || AVATAR_HEADS[0];
                    return (
                      <button
                        key={tone.id}
                        onClick={() => { SFX.tap(); setAvatarConfig((c) => ({ ...c, skinTone: tone.mod })); }}
                        className={`w-11 h-11 rounded-full flex items-center justify-center text-lg border-3 transition-all ${
                          avatarConfig.skinTone === tone.mod ? "border-amber-500 scale-110 bg-amber-50" : "border-stone-300 opacity-70"
                        }`}
                        style={{ borderWidth: "3px" }}
                        title={tone.label}
                      >
                        {head.base + tone.mod}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="bg-white p-4 sm:p-6 flex flex-col flex-1 justify-center" style={CARD_GOLD}>
              <p className="font-display font-700 text-sm uppercase tracking-wide text-amber-700 mb-4 sm:mb-6 text-center">Badge color</p>
              <div className="grid grid-cols-4 gap-3 sm:gap-6 justify-items-center">
                {BADGE_COLORS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => { SFX.tap(); setAvatarConfig((c) => ({ ...c, badge: b.id })); }}
                    className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full transition-all active:scale-90 ${
                      avatarConfig.badge === b.id ? "scale-110" : "opacity-60 hover:opacity-100"
                    }`}
                    style={{ background: b.gradient, border: avatarConfig.badge === b.id ? "4px solid #f59e0b" : "4px solid white", boxShadow: avatarConfig.badge === b.id ? "0 2px 8px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.08)" }}
                    title={b.label}
                  />
                ))}
              </div>
              <p className="font-hand text-xl text-stone-500 text-center mt-6">{BADGE_COLORS.find((b) => b.id === avatarConfig.badge)?.label}</p>
            </div>

            <div className="bg-white p-4 sm:p-6 flex flex-col flex-1 justify-center" style={CARD_GOLD}>
              <p className="font-display font-700 text-sm uppercase tracking-wide text-amber-700 mb-4 sm:mb-6 text-center">Gear</p>
              <div className="grid grid-cols-4 gap-3 sm:gap-6 justify-items-center">
                {ACCESSORY_STICKERS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { SFX.tap(); setAvatarConfig((c) => ({ ...c, accessory: a.id })); }}
                    className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-white flex items-center justify-center text-2xl sm:text-3xl transition-all active:scale-90 ${
                      avatarConfig.accessory === a.id ? "border-amber-500 scale-110 bg-amber-50" : "border-stone-300 opacity-60 hover:opacity-100"
                    }`}
                    style={{ borderWidth: "4px", boxShadow: avatarConfig.accessory === a.id ? "0 2px 8px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.08)" }}
                    title={a.label}
                  >
                    {a.emoji || "🚫"}
                  </button>
                ))}
              </div>
              <p className="font-hand text-sm text-stone-500 text-center mt-2">{ACCESSORY_STICKERS.find((a) => a.id === avatarConfig.accessory)?.label}</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 mt-6">
            <BigButton variant="ghost" onClick={() => setStep(1)}>
              <ChevronLeft className="inline w-4 h-4 mr-1" /> Back
            </BigButton>
            <BigButton onClick={() => setStep(3)}>
              Next <ArrowRight className="inline w-4 h-4 ml-1" />
            </BigButton>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white p-6 sm:p-8 step-in relative z-10 max-h-full overflow-y-auto" style={CARD_GOLD}>
          <div className="flex items-center gap-3 mb-5 bg-white rounded-2xl px-5 py-3" style={{ border: "2px solid #f59e0b" }}>
            <span className="text-3xl">🗺️</span>
            <div>
              <h1 className="font-display font-800 text-xl text-stone-700 leading-tight">Choose your map</h1>
              <p className="font-body text-xs text-stone-500">Pick where your adventure happens today</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {(() => {
              const entries = Object.entries(allPassages);
              const themes = getMapThemesForList(entries);
              return entries.map(([id, p], i, arr) => {
              const isLastOdd = arr.length % 2 === 1 && i === arr.length - 1;
              const theme = themes.get(id);
              const isSelected = passageId === id;
              // A faint dot texture (same visual language as the app's
              // compass/adventure motif elsewhere) keeps these cards from
              // reading as flat settings-menu swatches.
              const dotTexture = `radial-gradient(${theme.border}${isSelected ? "40" : "26"} 1.4px, transparent 1.4px)`;
              return (
                <button
                  key={id}
                  onClick={() => { SFX.tap(); setPassageId(id); }}
                  className={`rounded-2xl transition-all ${isLastOdd ? "col-span-2 flex items-center gap-3 text-left p-3" : "flex flex-col items-center text-center gap-1 p-3"} ${
                    isSelected ? "scale-[1.02]" : "hover:opacity-90"
                  }`}
                  style={{
                    borderWidth: "3px",
                    borderColor: theme.border,
                    background: `${dotTexture}, ${isSelected ? theme.gradient : theme.soft}`,
                    backgroundSize: "13px 13px, auto",
                  }}
                >
                  <span className="text-3xl shrink-0">{p.emoji}</span>
                  <div>
                    <p className="font-display font-800 text-sm" style={{ color: theme.text }}>{p.title}</p>
                    <p className="font-body text-[10px] leading-snug" style={{ color: theme.text }}>{SESSION_WORD_COUNT} tricky words{id.startsWith("custom-") ? " · custom" : ""}</p>
                  </div>
                </button>
              );
              });
            })()}
          </div>

          {passageId && allPassages[passageId] && (
            <div className="flex items-center gap-3 mt-4 bg-amber-50 rounded-2xl px-4 py-3 step-in" style={{ border: "2px solid #f59e0b" }}>
              <p className="font-display font-800 text-2xl text-amber-800">{SESSION_WORD_COUNT}</p>
              <div>
                <p className="font-display font-700 text-sm uppercase tracking-wide text-amber-700">Words Today</p>
                <p className="font-body text-[11px] text-stone-500">Fixed at {SESSION_WORD_COUNT} to keep each session's AI usage predictable</p>
              </div>
            </div>
          )}

          {!canAffordSession && (
            <p className="font-body text-xs text-rose-600 text-center mt-4" aria-live="polite">
              Today's practice sessions are full on this device. Come back tomorrow, or ask your teacher about the quota!
            </p>
          )}

          {authError && (
            <p className="font-body text-xs text-rose-600 text-center mt-4" aria-live="polite">
              {authError}
            </p>
          )}

          <div className="flex items-center justify-center gap-3 mt-6">
            <BigButton variant="ghost" onClick={() => setStep(2)}>
              <ChevronLeft className="inline w-4 h-4 mr-1" /> Back
            </BigButton>
            <BigButton
              onClick={async () => {
                if (!passageId) return;
                if (!pendingSignup) {
                  onBegin(studentId.trim(), avatarConfig, passageId, SESSION_WORD_COUNT);
                  return;
                }
                SFX.click();
                setAuthLoading(true);
                setAuthError(null);
                try {
                  const data = await studentSignup(studentId.trim(), authSecret, avatarConfig);
                  onStudentAuthenticated(data.token, data.expiresAt, data.student);
                  setPendingSignup(false);
                  setAuthSecret([]);
                  onBegin(studentId.trim(), avatarConfig, passageId, SESSION_WORD_COUNT);
                } catch (e) {
                  setAuthError(e.message || "Couldn't create the account, please try again");
                } finally {
                  setAuthLoading(false);
                }
              }}
              disabled={!passageId || !canAffordSession || authLoading}
            >
              {authLoading ? "Creating account…" : "Start my adventure"} <ArrowRight className="inline w-4 h-4 ml-1" />
            </BigButton>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Progress Trail ---------------- */
// Computed rather than a fixed 5-point array so the trail always spans the
// full viewBox width and stays centered, no matter how many words a session
// (or a teacher's custom map) has — slicing a fixed array from the left
// used to leave shorter sessions bunched against the left edge instead of
// spread across the available width.
function computeTrailPoints(n) {
  if (n <= 0) return [];
  const viewWidth = 1190;
  const margin = 70;
  const bottomY = 88;
  const topY = 28;
  return Array.from({ length: n }, (_, i) => {
    const x = n === 1 ? viewWidth / 2 : margin + ((viewWidth - margin * 2) * i) / (n - 1);
    const y = i % 2 === 0 ? bottomY : topY;
    return [x, y];
  });
}

function trailPath(points) {
  return points
    .map((p, i) => {
      if (i === 0) return `M${p[0]},${p[1]}`;
      const prev = points[i - 1];
      const midX = (prev[0] + p[0]) / 2;
      const bend = i % 2 === 0 ? -34 : 34;
      return `Q${midX},${prev[1] + bend} ${p[0]},${p[1]}`;
    })
    .join(" ");
}

function ProgressTrail({ words, solvedWords, avatarConfig, totalMilestone }) {
  const solvedCount = solvedWords.length;
  const points = computeTrailPoints(words.length);
  const pathD = trailPath(points);
  const stoneColors = ["#16a34a", "#0e7490", "#f59e0b", "#c2410c", "#be185d"];

  return (
    <div className="mb-6 bg-white p-5" style={CARD_GOLD}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-display font-800 text-sm text-amber-800 flex items-center gap-1">
          <Footprints className="w-4 h-4" /> The Trail
        </p>
        <p className="font-body text-xs font-800 text-stone-500">{solvedCount} / {words.length} found</p>
      </div>
      <svg viewBox="0 0 1190 120" className="w-full" style={{ height: 130 }} preserveAspectRatio="xMidYMid meet">
        <path d={pathD} fill="none" stroke="#d6b370" strokeWidth="7" strokeLinecap="round" />
        <path d={pathD} fill="none" stroke="#78716c" strokeWidth="1.5" strokeDasharray="1 10" strokeLinecap="round" opacity="0.5" />
        {points.map((p, i) => {
          const solved = i < solvedCount;
          const isCurrent = i === solvedCount;
          return (
            <g key={i}>
              {isCurrent && (
                <text x={p[0] - 40} y={p[1] + 6} textAnchor="middle" fontSize="34" className="bounce-in">
                  {composeAvatarEmoji(avatarConfig)}
                </text>
              )}
              <circle cx={p[0]} cy={p[1]} r="17" fill={solved ? stoneColors[i % stoneColors.length] : "#e7e5e4"} stroke="white" strokeWidth="3.5" />
              <text x={p[0]} y={p[1] + 6} textAnchor="middle" fontSize="15" fontWeight="800" fill={solved ? "white" : "#a8a29e"}>
                {solved ? "✓" : i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      {totalMilestone && (
        <div className="flex items-center justify-center gap-2 mt-2 step-in bounce-in">
          <span
            className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shrink-0"
            style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
          >
            {totalMilestone.emoji}
          </span>
          <div className="text-left">
            <p className="font-display font-800 text-base text-amber-700 leading-tight">{totalMilestone.title}</p>
            <p className="font-body text-xs text-stone-500 leading-tight">{totalMilestone.subtitle}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Passage Screen ---------------- */
// Pastel cloud-bank progression for not-yet-reachable passage sentences,
// so a glance at the stack of placeholder clouds shows how much story is
// still ahead: the cloud right after the revealable one is a touch more
// solid/defined, and each one further out is paler and hazier, reading
// naturally as "the story fades into the distance." Purely decorative
// (no text sits on these anymore), so there's no WCAG contrast pairing
// to maintain, unlike the shade+text combo this replaced.
const CLOUD_SHADES = ["#7dd3fc", "#9fe0fb", "#c3ecfc", "#e0f6fd", "#f5fbfe"];

function cloudShade(t) {
  const idx = Math.round(t * (CLOUD_SHADES.length - 1));
  return CLOUD_SHADES[Math.max(0, Math.min(CLOUD_SHADES.length - 1, idx))];
}

function PassageScreen({ passage, solvedWords, onPickWord, onOpenTeacher, onSwitchStudent, avatarConfig, totalLogCount, streakMsg, studentId, log, sessionStartedAt, revealedCount, onRevealNext, bilingual }) {
  // Fires a CloudPuff over whichever sentence was just revealed, briefly,
  // then clears itself. Tracked here (rather than in the button, which
  // unmounts the instant revealedCount changes) so the animation attaches
  // to the newly-revealed paragraph sliding into view instead.
  const [puffIndex, setPuffIndex] = useState(null);
  const prevRevealedCount = useRef(revealedCount);
  useEffect(() => {
    if (revealedCount > prevRevealedCount.current) {
      const justRevealed = revealedCount - 1;
      setPuffIndex(justRevealed);
      const t = setTimeout(() => setPuffIndex(null), 700);
      prevRevealedCount.current = revealedCount;
      return () => clearTimeout(t);
    }
    prevRevealedCount.current = revealedCount;
  }, [revealedCount]);

  const milestone =
    totalLogCount >= 20 ? { emoji: "🏆", title: "Legendary Explorer", subtitle: "20+ words solved!" } :
    totalLogCount >= 10 ? { emoji: "🗺️", title: "Map Master", subtitle: "10+ words solved!" } :
    totalLogCount >= 5 ? { emoji: "🧭", title: "Trail Blazer", subtitle: "5+ words solved!" } : null;

  const highlightWords = (text, keyPrefix) => {
    // Find every target word's actual position in this sentence first, then
    // render left to right by that position, not by passage.words' array
    // order. Custom (AI-generated) maps have no guarantee their words array
    // is in textual order, e.g. two target words sharing one sentence can
    // easily come back in either order, same for a teacher's typed word
    // order in the level maker. Iterating in array order while slicing
    // `remaining` sequentially meant a word appearing earlier in the text
    // than an array-earlier word would search a `remaining` already sliced
    // past its position, silently never match, and stay unhighlighted and
    // untappable forever, softlocking that map.
    const matches = [];
    passage.words.forEach((w) => {
      const idx = text.toLowerCase().indexOf(w.word.toLowerCase());
      if (idx !== -1) matches.push({ w, idx });
    });
    matches.sort((a, b) => a.idx - b.idx);

    const parts = [];
    let cursor = 0;
    let key = 0;
    matches.forEach(({ w, idx }) => {
      if (idx < cursor) return; // overlapping match (e.g. one word contains another), skip
      parts.push(<span key={`${keyPrefix}t${key++}`}>{text.slice(cursor, idx)}</span>);
      const matched = text.slice(idx, idx + w.word.length);
      const solved = solvedWords.includes(w.word);
      parts.push(
        <button
          key={`${keyPrefix}w${key++}-${solved}`}
          onClick={() => { if (!solved) { SFX.select(); unlockSpeechOnce(); onPickWord(w); } }}
          className={`font-display font-800 px-2 py-0.5 rounded-full transition-all inline-block ${
            solved
              ? "bg-emerald-100 text-emerald-700 line-through decoration-2 rotate-0 bounce-in"
              : "text-stone-800 hover:scale-110 -rotate-1"
          }`}
          style={!solved ? { background: "linear-gradient(135deg,#fde68a,#fdba74)", boxShadow: "0 3px 0 0 #d97706" } : {}}
        >
          {matched}
        </button>
      );
      cursor = idx + w.word.length;
    });
    parts.push(<span key={`${keyPrefix}t${key++}`}>{text.slice(cursor)}</span>);
    return parts;
  };

  const sentences = passage.text.match(/[^.!?]+[.!?]+/g) || [passage.text];

  const renderPassage = () => {
    return sentences.map((sentence, i) => {
      if (i < revealedCount) {
        return (
          <p key={i} className="relative mb-3 last:mb-0 step-in flex items-start gap-1.5" style={{ breakInside: "avoid" }}>
            {puffIndex === i && <CloudPuff />}
            <span>{highlightWords(sentence.trim(), `s${i}-`)}</span>
            <button
              onClick={() => speak(sentence.trim())}
              className="shrink-0 mt-0.5 w-11 h-11 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-sm"
              title="Read this sentence aloud"
              aria-label="Read this sentence aloud"
            >
              🔊
            </button>
          </p>
        );
      }
      if (i === revealedCount) {
        return (
          <button
            key={i}
            onClick={() => { SFX.pageTurn(); onRevealNext(); }}
            className="group relative w-full mb-3 h-14 rounded-2xl overflow-hidden transition-transform hover:scale-[1.02] step-in"
            style={{ breakInside: "avoid" }}
          >
            <CloudShape fill="#bae6fd" className="absolute inset-0 transition-transform group-hover:scale-105" />
            <span className="relative z-10 flex items-center justify-center h-full font-hand text-lg text-sky-900 italic">
              🔒 tap to reveal the next part of the story…
            </span>
          </button>
        );
      }
      // Sentences further ahead than the next revealable one: shown as a
      // drifting cloud placeholder (not left blank) so the passage box is
      // already at its full final height from the start, instead of
      // visibly growing every time a part gets revealed. Fades paler the
      // further away it is.
      const totalUpcoming = sentences.length - (revealedCount + 1);
      const posAmongUpcoming = i - (revealedCount + 1);
      const t = totalUpcoming > 1 ? posAmongUpcoming / (totalUpcoming - 1) : 0;
      const shade = cloudShade(t);
      return (
        <div
          key={i}
          aria-hidden="true"
          className="w-full mb-3 h-14 rounded-2xl overflow-hidden step-in"
          style={{ breakInside: "avoid" }}
        >
          <CloudShape fill={shade} />
        </div>
      );
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 step-in relative">
      <FloatingDecor density={5} />
      {/* pl-14/pr-14 clear the fixed close (X) and sound-toggle buttons
          pinned at top-4 left-4 / top-4 right-4 (same overlap fixed on
          TeacherScreen: this row's title and "Teacher view" button would
          otherwise sit underneath them). */}
      <div className="flex items-center gap-2 mb-5 relative z-10 pl-14 pr-14">
        <CompassRose size={36} />
        <p className="font-display font-800 text-xl sticker-title">G.I.S.T.</p>
        <SessionTimer startedAt={sessionStartedAt} className="ml-auto font-mono text-xs text-stone-500 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300" />
        {onSwitchStudent && (
          <button
            onClick={() => { SFX.tap(); onSwitchStudent(); }}
            className="flex items-center gap-1 font-display font-700 text-xs text-stone-600 hover:text-stone-800 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300 shadow-sm"
            title="Save this device for the next student"
          >
            <RotateCcw className="w-3.5 h-3.5" /> New Student
          </button>
        )}
        <button onClick={() => { SFX.tap(); onOpenTeacher(); }} className="flex items-center gap-1 font-display font-700 text-xs text-stone-600 hover:text-stone-800 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300 shadow-sm">
          <GraduationCap className="w-3.5 h-3.5" /> Teacher view
        </button>
      </div>

      <div className="relative z-10">
      <ProgressTrail words={passage.words} solvedWords={solvedWords} avatarConfig={avatarConfig} totalMilestone={milestone} />

      {streakMsg && (
        <div className="border-4 border-emerald-300 bg-emerald-50 text-emerald-700 font-hand text-lg px-4 py-3 mb-6 rounded-2xl text-center step-in bounce-in">
          {streakMsg}
        </div>
      )}

      {passage.mission && solvedWords.length < passage.words.length && (
        <div className="mb-6 p-4 rounded-2xl flex items-start gap-2" style={{ background: "#fffbeb", border: "2px dashed #f59e0b" }}>
          <span className="text-2xl shrink-0">🎯</span>
          <p className="font-hand text-lg leading-snug" style={{ color: "#9a3412" }}>{passage.mission}</p>
        </div>
      )}

      <div className="bg-white p-6" style={CARD_GOLD}>
        <h1 className="font-display text-2xl font-800 mb-4 flex items-center gap-2" style={{ color: "#9a3412" }}>
          <span className="text-3xl">{passage.emoji}</span> {passage.title}
        </h1>
        <div className="font-body text-lg leading-9 text-stone-700" style={{ columnCount: 2, columnGap: "2.5rem" }}>{renderPassage()}</div>
      </div>
      <p className="relative z-50 font-hand text-lg text-stone-600 mt-4 text-center bg-white/90 rounded-xl py-1.5">
        {revealedCount < sentences.length ? "📖 Read on, then tap a marked spot you don't know!" : "👆 Tap a marked spot you don't know!"}
        {bilingual && (
          <span className="block font-body text-stone-500" style={{ fontSize: "0.8em" }}>
            {revealedCount < sentences.length ? "Terus baca, kemudian ketik bahagian bertanda yang anda tak tahu!" : "Ketik bahagian bertanda yang anda tak tahu!"}
          </span>
        )}
      </p>

      {solvedWords.length === passage.words.length && (
        <div className="mt-8 p-6 text-center step-in bounce-in" style={{ ...CARD_GOLD, boxShadow: CARD_SHADOW_HERO, background: "linear-gradient(135deg,#fef3c7,#fed7aa)" }}>
          <Trophy className="w-10 h-10 mx-auto mb-2 text-orange-500" />
          <p className="font-display text-2xl font-800 text-stone-700">Adventure complete! 🎉</p>
          {passage.arrival && <p className="font-hand text-xl text-amber-700 mt-2">{passage.arrival}</p>}
          <p className="font-body text-xs text-stone-500 mt-3">Ask your teacher to check your report card.</p>
        </div>
      )}
      </div>
    </div>
  );
}

/* ---------------- Sound effects (synthesized, no audio files needed) ---------------- */
let audioCtx = null;
let soundEnabled = true;

function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, startOffset, duration, type = "sine", volume = 0.18) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  } catch (e) {
    /* audio unsupported, fail silently */
  }
}

const SFX = {
  click: () => playTone(400, 0, 0.08, "sine", 0.035),
  tap: () => playTone(620, 0, 0.05, "sine", 0.03),
  remove: () => playTone(260, 0, 0.07, "sine", 0.035),
  select: () => { playTone(700, 0, 0.05, "sine", 0.04); playTone(920, 0.045, 0.07, "sine", 0.035); },
  pageTurn: () => { playTone(320, 0, 0.06, "triangle", 0.04); playTone(220, 0.05, 0.09, "triangle", 0.03); },
  correct: () => { playTone(523.25, 0, 0.12); playTone(783.99, 0.09, 0.18); },
  hint: () => playTone(340, 0, 0.22, "sine", 0.12),
  resolved: () => { playTone(523.25, 0, 0.1); playTone(659.25, 0.1, 0.1); playTone(783.99, 0.2, 0.28); },
  milestone: () => { playTone(523.25, 0, 0.1); playTone(659.25, 0.1, 0.1); playTone(783.99, 0.2, 0.1); playTone(1046.5, 0.3, 0.4); },
  trophy: () => { playTone(523.25, 0, 0.1); playTone(659.25, 0.09, 0.1); playTone(783.99, 0.18, 0.1); playTone(1046.5, 0.27, 0.15); playTone(1318.51, 0.4, 0.4); },
  reportReady: () => { playTone(659.25, 0, 0.12); playTone(987.77, 0.1, 0.25, "sine", 0.14); },
};

/* ---------------- Ambient background music (generative, original, no audio files) ---------------- */
// A short, cheerful, singsong melody in C major that loops. Simple and memorable rather than abstract.
const SCALE_C = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25]; // C D E F G A B C5
const BEAT = 0.4; // seconds per beat, gentle skipping pace
const MELODY_PHRASE = [
  { n: 0, d: 1 }, { n: 2, d: 1 }, { n: 4, d: 1 }, { n: 2, d: 1 },
  { n: 3, d: 1 }, { n: 1, d: 1 }, { n: 0, d: 2 }, { n: -1, d: 1 },
  { n: 4, d: 1 }, { n: 4, d: 1 }, { n: 5, d: 1 }, { n: 4, d: 1 },
  { n: 2, d: 1 }, { n: 0, d: 1 }, { n: 0, d: 2 }, { n: -1, d: 1.5 },
];
let musicRunning = false;
let musicTimer = null;
let melodyIndex = 0;

function playMelodyNote(freq, beats, volume) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const dur = beats * BEAT;
  try {
    const t0 = ctx.currentTime;

    // Fundamental: warm sine, natural percussive decay (music-box / glockenspiel character)
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = freq;
    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0.0001, t0);
    gain1.gain.linearRampToValueAtTime(volume, t0 + 0.012);
    gain1.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t0);
    osc1.stop(t0 + dur + 0.05);

    // Soft bright overtone one octave up, quiet, fades faster, adds a gentle sparkle without buzz
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq * 2;
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.0001, t0);
    gain2.gain.linearRampToValueAtTime(volume * 0.22, t0 + 0.008);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t0);
    osc2.stop(t0 + dur * 0.55 + 0.05);
  } catch (e) {
    /* audio unsupported, fail silently */
  }
}

function scheduleNextAmbientNote() {
  if (!musicRunning) return;
  const step = MELODY_PHRASE[melodyIndex];
  if (soundEnabled && step.n >= 0) {
    playMelodyNote(SCALE_C[step.n], step.d, 0.04);
  }
  const gap = step.d * BEAT;
  melodyIndex = (melodyIndex + 1) % MELODY_PHRASE.length;
  musicTimer = setTimeout(scheduleNextAmbientNote, gap * 1000);
}

function startBackgroundMusic() {
  if (musicRunning) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  musicRunning = true;
  melodyIndex = 0;
  scheduleNextAmbientNote();
}

function stopBackgroundMusic() {
  musicRunning = false;
  if (musicTimer) clearTimeout(musicTimer);
  musicTimer = null;
}

function setSoundEnabledGlobal(next) {
  soundEnabled = next;
  if (next) {
    SFX.click();
    startBackgroundMusic();
  } else {
    stopBackgroundMusic();
  }
}

function SessionTimer({ startedAt, className = "" }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return <span className={className}>⏱ {mm}:{ss}</span>;
}

function SoundToggle({ soundOn, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="fixed top-4 right-4 z-50 w-11 h-11 rounded-full bg-white flex items-center justify-center text-lg"
      style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
      title={soundOn ? "Mute sound" : "Unmute sound"}
      aria-label={soundOn ? "Mute sound" : "Unmute sound"}
    >
      {soundOn ? "🔊" : "🔇"}
    </button>
  );
}

function CloseButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="fixed top-4 left-4 z-50 w-11 h-11 rounded-full bg-white flex items-center justify-center text-lg text-stone-500"
      style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
      title="Close G.I.S.T."
      aria-label="Close G.I.S.T."
    >
      ✕
    </button>
  );
}

function CloseConfirmModal({ onCancel, onConfirm, screen, studentId }) {
  const inActiveSession = screen === "passage" || screen === "coach" || screen === "comprehension" || screen === "teacher";
  const atRecap = screen === "recap";
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  // Move focus into the dialog on open (the less-destructive "Cancel"
  // option, so an accidental Enter/Space doesn't close the app). Mount-only
  // (empty deps) — `onCancel` is a fresh inline arrow function on every
  // App render, so if this ran on every `onCancel` change it would yank
  // focus back to Cancel any time something elsewhere in the app happened
  // to re-render while the modal was open, even after the student had
  // already tabbed to "Yes, close".
  useEffect(() => {
    cancelRef.current?.focus();
    // eslint-disable-next-line
  }, []);

  // The Tab-trap/Escape listener is safe to re-attach on every `onCancel`
  // change (unlike the focus() above, re-adding a keydown listener has no
  // visible side effect), so it can just always call the latest onCancel.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") { onCancel(); return; }
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === cancelRef.current) {
        e.preventDefault();
        confirmRef.current?.focus();
      } else if (!e.shiftKey && document.activeElement === confirmRef.current) {
        e.preventDefault();
        cancelRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 flex items-center justify-center p-6" style={{ zIndex: 1000 }}>
      <div className="absolute inset-0" style={{ background: "rgba(41,37,36,0.55)", backdropFilter: "blur(4px)" }} onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-confirm-heading"
        className="relative bg-white p-6 sm:p-8 text-center max-w-sm w-full step-in"
        style={CARD_NEUTRAL}
      >
        <p className="text-4xl mb-3">🧭</p>
        <p id="close-confirm-heading" className="font-display font-800 text-xl text-stone-700 mb-2">Are you sure you want to close G.I.S.T.?</p>
        <p className="font-body text-sm text-stone-500 mb-6">
          {inActiveSession
            ? `${studentId ? `${studentId}'s` : "This"} session is still in progress. All progress will be lost and can't be recovered.`
            : atRecap
              ? `Make sure your teacher has downloaded ${studentId ? `${studentId}'s` : "the"} results first, this session's data won't be saved once you close.`
              : "Any progress in this session won't be saved once you close."}
        </p>
        <div className="flex items-center justify-center gap-3">
          <BigButton ref={cancelRef} variant="ghost" onClick={onCancel}>
            Cancel
          </BigButton>
          <BigButton ref={confirmRef} variant="outline" onClick={onConfirm}>
            Yes, close
          </BigButton>
        </div>
      </div>
    </div>
  );
}

// Teacher-mediated recovery for a student who forgot their secret animals
// (see resetStudentSecret): reuses SecretAnimalPicker so picking the new
// sequence looks identical to signup/login, just from the teacher's
// device. Unlike CloseConfirmModal's 2-button focus trap, this dialog has
// many focusable controls (8 animal buttons plus Cancel/Confirm), so the
// trap here cycles through every focusable element inside the dialog
// rather than hardcoding first/last refs.
function ResetSecretModal({ student, onCancel, onReset }) {
  const [secret, setSecret] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") { onCancel(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")
      ).filter((el) => !el.disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  async function handleConfirm() {
    if (secret.length !== SECRET_LENGTH || loading) return;
    SFX.click();
    setLoading(true);
    setError(null);
    try {
      await resetStudentSecret(student.id, secret);
      onReset();
    } catch (e) {
      setError(e.message || "Couldn't reset the secret, please try again");
    } finally {
      setLoading(false);
    }
  }

  // Portal straight to document.body: this modal is opened from inside
  // FileBoxScreen's own root div, which carries the "step-in" entrance
  // animation class. That animation's keyframes set a (non-"none")
  // transform, and per CSS spec any element with a transform becomes the
  // containing block for its `position: fixed` descendants — so without
  // the portal, "fixed inset-0" below would size itself to FileBoxScreen's
  // own max-w-2xl column instead of the real viewport, leaving the
  // backdrop as a dark rectangle in the middle of the screen instead of
  // covering it edge to edge.
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-6" style={{ zIndex: 1000 }}>
      <div className="absolute inset-0" style={{ background: "rgba(41,37,36,0.55)", backdropFilter: "blur(4px)" }} onClick={onCancel} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-secret-heading"
        className="relative bg-white p-6 sm:p-8 text-center max-w-sm w-full step-in"
        style={CARD_NEUTRAL}
      >
        <p className="text-4xl mb-3">🔑</p>
        <p id="reset-secret-heading" className="font-display font-800 text-xl text-stone-700 mb-2">
          Reset {student.fullName}'s secret
        </p>
        <p className="font-body text-sm text-stone-500 mb-5">
          Pick 3 new secret animals with {student.fullName} right now, then have them log in with these instead of the old ones.
        </p>
        <SecretAnimalPicker value={secret} onChange={setSecret} />
        {error && <p className="font-body text-xs text-rose-600 text-center mt-4" aria-live="polite">{error}</p>}
        <div className="flex items-center justify-center gap-3 mt-6">
          <BigButton variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </BigButton>
          <BigButton onClick={handleConfirm} disabled={secret.length !== SECRET_LENGTH || loading}>
            {loading ? "Saving…" : "Set new secret"}
          </BigButton>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Generic "are you sure" dialog for a permanent, irreversible delete —
// used by the File Box for both deleting one session and deleting a whole
// student account (see FileBoxScreen). Only two focusable controls
// (Cancel/Confirm), so this reuses CloseConfirmModal's simpler 2-ref tab
// trap rather than ResetSecretModal's generic multi-element one.
function ConfirmDeleteModal({ heading, message, confirmLabel = "Yes, delete", onCancel, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      // Guard against closing (and unmounting this component) while a
      // delete is still in flight — see the matching guard on the
      // backdrop's onClick below for why.
      if (e.key === "Escape") { if (!loading) onCancel(); return; }
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === cancelRef.current) {
        e.preventDefault();
        confirmRef.current?.focus();
      } else if (!e.shiftKey && document.activeElement === confirmRef.current) {
        e.preventDefault();
        cancelRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, loading]);

  async function handleConfirm() {
    if (loading) return;
    SFX.click();
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e.message || "Couldn't delete, please try again");
      setLoading(false);
    }
  }

  // The Cancel button already disables itself while loading; the backdrop
  // needs the same guard so a stray click mid-delete can't unmount this
  // modal out from under its own pending onConfirm() — otherwise the
  // eventual result (including an error, which this modal is the only
  // place that shows it) never reaches the teacher.
  function handleBackdropClick() {
    if (!loading) onCancel();
  }

  // Portal straight to document.body — same reasoning as ResetSecretModal
  // above: this is opened from inside FileBoxScreen's "step-in"-classed
  // root div, whose entrance-animation transform would otherwise trap
  // "fixed inset-0" to that div's own bounds instead of the real viewport.
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-6" style={{ zIndex: 1000 }}>
      <div className="absolute inset-0" style={{ background: "rgba(41,37,36,0.55)", backdropFilter: "blur(4px)" }} onClick={handleBackdropClick} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-heading"
        className="relative bg-white p-6 sm:p-8 text-center max-w-sm w-full step-in"
        style={CARD_NEUTRAL}
      >
        <p className="text-4xl mb-3">🗑️</p>
        <p id="confirm-delete-heading" className="font-display font-800 text-xl text-stone-700 mb-2">
          {heading}
        </p>
        <p className="font-body text-sm text-stone-500 mb-2">{message}</p>
        <p className="font-body text-xs text-rose-600 font-700 mb-5">This can't be undone.</p>
        {error && <p className="font-body text-xs text-rose-600 text-center mb-4" aria-live="polite">{error}</p>}
        <div className="flex items-center justify-center gap-3">
          <BigButton ref={cancelRef} variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </BigButton>
          <BigButton ref={confirmRef} variant="outline" onClick={handleConfirm} disabled={loading}>
            {loading ? "Deleting…" : confirmLabel}
          </BigButton>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ClosedScreen() {
  return (
    <div className="max-w-md mx-auto px-6 py-10 step-in relative min-h-screen flex flex-col justify-center text-center">
      <p className="text-6xl mb-4">🧭</p>
      <p className="font-display font-800 text-2xl text-stone-700 mb-2">G.I.S.T. is now closed</p>
      <p className="font-body text-sm text-stone-500">You can close this tab now.</p>
    </div>
  );
}

let speechUnlocked = false;
function unlockSpeechOnce() {
  if (speechUnlocked) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const utter = new SpeechSynthesisUtterance("");
    utter.volume = 0;
    synth.speak(utter);
    speechUnlocked = true;
  } catch (e) {
    /* speech synthesis unsupported, fail silently */
  }
}

function pickWarmVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices() || [];
  if (!voices.length) return null;
  const preferredNames = [
    "Samantha",
    "Microsoft Aria Online (Natural) - English (United States)",
    "Microsoft Jenny Online (Natural) - English (United States)",
    "Google UK English Female",
    "Karen",
    "Moira",
    "Google US English",
  ];
  for (const name of preferredNames) {
    const v = voices.find((v) => v.name === name);
    if (v) return v;
  }
  const enVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
  return enVoices[0] || voices[0] || null;
}

function speak(text) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickWarmVoice();
    if (voice) utter.voice = voice;
    utter.rate = 0.94;
    utter.pitch = 1.08;
    utter.volume = 1;
    synth.speak(utter);
  } catch (e) {
    /* speech synthesis unsupported, fail silently */
  }
}

/* ---------------- Coach Screen ---------------- */
function WordBankWidget({ tiles, onSubmit, disabled = false }) {
  const [used, setUsed] = useState([]);
  const building = used.map((i) => tiles[i]).join("");

  function tapTile(i) {
    if (disabled || used.includes(i)) return;
    SFX.tap();
    setUsed((u) => [...u, i]);
  }
  function removeLast() {
    SFX.remove();
    setUsed((u) => u.slice(0, -1));
  }

  return (
    <div className="step-in">
      <div className="flex items-center justify-center gap-1.5 mb-4 min-h-[3.25rem] flex-wrap">
        {used.length === 0 && <span className="font-hand text-stone-500 text-lg">tap the letters below...</span>}
        {used.map((i, idx) => (
          <span
            key={idx}
            className="w-11 h-11 flex items-center justify-center bg-teal-50 rounded-lg font-display font-800 text-xl uppercase bounce-in"
            style={{ border: "3px solid #0d9488" }}
          >
            {tiles[i]}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 justify-center mb-4">
        {tiles.map((letter, i) => {
          const isUsed = used.includes(i);
          return (
            <button
              key={i}
              disabled={isUsed || disabled}
              onClick={() => tapTile(i)}
              className={`w-11 h-11 rounded-lg font-display font-800 text-xl uppercase transition-all hover:scale-105 ${
                isUsed ? "bg-teal-100 text-teal-700 scale-90" : "bg-amber-100 text-stone-800"
              }`}
              style={{ border: `3px solid ${isUsed ? "#0d9488" : "#f59e0b"}` }}
            >
              {letter}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-3">
        <BigButton silent variant="ghost" onClick={removeLast} disabled={used.length === 0 || disabled}>
          ⌫ Remove
        </BigButton>
        <BigButton onClick={() => onSubmit(building)} disabled={used.length === 0 || disabled}>
          Submit
        </BigButton>
      </div>
    </div>
  );
}

function LetterConnectWidget({ tiles, onSubmit, disabled = false }) {
  const [used, setUsed] = useState([]);
  const building = used.map((i) => tiles[i]).join("");
  const n = tiles.length;
  const size = 230;
  const cx = size / 2;
  const cy = size / 2;
  const r = Math.min(95, 55 + n * 4);

  const positions = tiles.map((_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  function tapTile(i) {
    if (disabled || used.includes(i)) return;
    SFX.tap();
    setUsed((u) => [...u, i]);
  }
  function removeLast() {
    SFX.remove();
    setUsed((u) => u.slice(0, -1));
  }

  return (
    <div className="step-in flex flex-col items-center">
      <div className="mb-3 min-h-[2.75rem] flex items-center justify-center flex-wrap gap-1">
        {used.length === 0 && <span className="font-hand text-stone-500 text-lg">connect the letters below...</span>}
        {used.map((i, idx) => (
          <span
            key={idx}
            className="w-9 h-9 flex items-center justify-center bg-teal-50 rounded-lg font-display font-800 text-lg uppercase bounce-in"
            style={{ border: "3px solid #0d9488" }}
          >
            {tiles[i]}
          </span>
        ))}
      </div>

      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="absolute inset-0 pointer-events-none">
          {used.slice(1).map((idx, k) => {
            const from = positions[used[k]];
            const to = positions[idx];
            return (
              <line
                key={k}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#0d9488"
                strokeWidth="5"
                strokeLinecap="round"
                className="step-in"
              />
            );
          })}
        </svg>
        {tiles.map((letter, i) => {
          const isUsed = used.includes(i);
          const pos = positions[i];
          return (
            <button
              key={i}
              disabled={isUsed || disabled}
              onClick={() => tapTile(i)}
              className={`absolute w-11 h-11 rounded-full font-display font-800 text-lg uppercase flex items-center justify-center transition-all hover:scale-110 ${
                isUsed ? "bg-teal-100 text-teal-700 scale-90" : "bg-amber-100 text-stone-800"
              }`}
              style={{
                left: pos.x,
                top: pos.y,
                transform: "translate(-50%, -50%)",
                border: `3px solid ${isUsed ? "#0d9488" : "#f59e0b"}`,
                zIndex: 2,
              }}
            >
              {letter}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-3 mt-4">
        <BigButton silent variant="ghost" onClick={removeLast} disabled={used.length === 0 || disabled}>
          ⌫ Remove
        </BigButton>
        <BigButton onClick={() => onSubmit(building)} disabled={used.length === 0 || disabled}>
          Submit
        </BigButton>
      </div>
    </div>
  );
}


// STAGE1_CYCLE/STAGE2_CYCLE/STAGE3_CYCLE are imported from ../shared/prompts.js.

// Quiet "coach is typing" cue: replaces the old static "is thinking… 🤔"
// text. Used both while waiting on the AI response and, briefly, as the
// first frame of a just-arrived message before its first letter reveals,
// so there's no separate pop-in between "thinking" and "typing".
function ThinkingDots({ label }) {
  return (
    <span className="inline-flex items-center" role="status">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="flex items-center gap-1 py-1">
        <span className="w-2 h-2 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-2 h-2 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-2 h-2 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: "300ms" }} />
      </span>
    </span>
  );
}

// Groups CoachScreen's flat message list into one entry per exchange
// "slide" (flashcard), so the UI shows one coach turn + the student's
// reply to it at a time, instead of a long scrolling transcript. A new
// slide starts on every coach message (question, feedback, resolution,
// or the free-form skip/reveal message alike) — grouping by stage
// instead used to let a stuck word's several wrong-attempt exchanges
// (up to STUCK_WORD_LIMIT) all pile onto one slide, which brought back
// the same crowded-screen problem this redesign exists to avoid. Each
// group still carries a `.stage` label (from its own coach message, or
// inherited from the previous group for the stage-less skip/reveal
// message) since the header's "Stage X of 5" progress display needs it
// — that's independent of how many flashcards a stage took to clear.
function groupMessagesByExchange(display) {
  const groups = [];
  display.forEach((m, idx) => {
    const isCoachMsg = m.from === "coach";
    if (isCoachMsg || groups.length === 0) {
      const prevStage = groups[groups.length - 1]?.stage ?? 1;
      groups.push({ stage: typeof m.stage === "number" ? m.stage : prevStage, items: [] });
    }
    groups[groups.length - 1].items.push({ msg: m, idx });
  });
  return groups;
}

function CoachScreen({ passage, targetWord, avatarConfig, onWordResolved, onBack, soundOn, onToggleSound, wordIndex, isTransferWord, bilingual }) {
  const stage1Type = STAGE1_CYCLE[wordIndex % STAGE1_CYCLE.length];
  const stage2Type = STAGE2_CYCLE[wordIndex % STAGE2_CYCLE.length];
  const stage3Type = STAGE3_CYCLE[(wordIndex + 1) % STAGE3_CYCLE.length];
  const [history, setHistory] = useState([]);
  const [display, setDisplay] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [error, setError] = useState(null);
  const [stageReached, setStageReached] = useState(1);
  const [wordDone, setWordDone] = useState(false);
  const hintsUsedRef = useRef(0);
  const exchangeCountRef = useRef(0);
  const scrollRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  // skipWord defers onWordResolved by 2.2s so the student has time to read
  // the reveal message. If they tap Back (or the parent otherwise unmounts
  // this screen) before that fires, this must be cancelled -- otherwise the
  // pending call lands after they've already re-opened and re-skipped the
  // same word from PassageScreen, double-appending it to the log/report.
  const skipTimeoutRef = useRef(null);
  useEffect(() => () => { if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current); }, []);

  // Slide navigation: one slide per stage instead of one long scrolling
  // transcript, which used to crowd out readability. activeSlide follows
  // the newest stage automatically (see the effect below); manually
  // stepping back with the arrows overrides that until the next new stage
  // arrives, at which point auto-follow resumes.
  const [activeSlide, setActiveSlide] = useState(0);

  // Reflection flow state
  const [prePhase, setPrePhase] = useState("prior"); // "prior" | "coaching"
  const [priorKnowledge, setPriorKnowledge] = useState(null);
  const [postPhase, setPostPhase] = useState(null); // null | "gotItVia" | "whichClue" | "transfer"
  const [gotItVia, setGotItVia] = useState(null);
  const [clueIdentified, setClueIdentified] = useState(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferData, setTransferData] = useState(null);
  const [transferPassed, setTransferPassed] = useState(null);
  const wordStartRef = useRef(null);
  // Sum of every pacing-gate hold (both phases) enforced on this word so
  // far, in ms. Compared against the actual timeToAnswerSec at
  // resolution to flag answers that landed right at the enforced floor
  // (see appendCoachMessage and computeAtAGlance/logForModel).
  const gateMsAccumRef = useRef(0);
  const resolvedBaseRef = useRef(null);
  const [pacingElapsed, setPacingElapsed] = useState(0);

  // Typewriter reveal + two-phase pacing gate: a coach message is
  // revealed letter-by-letter, and (when opts.lockAnswers is set) the
  // answer controls stay hidden until it finishes (answersLocked), with a
  // minimum lock duration so even a one-word message doesn't unlock
  // instantly. Once that clears, the options render right away — so
  // there's something to actually read while waiting, not just a "read
  // the message" placeholder — but stay disabled and visually settling
  // in for a second phase (answersEnabled) scaled by how much the
  // options themselves take to read (see OPTIONS_READ_CHAR_MS above).
  const [typingIndex, setTypingIndex] = useState(null);
  const [revealedLength, setRevealedLength] = useState(0);
  const [answersLocked, setAnswersLocked] = useState(false);
  const [answersEnabled, setAnswersEnabled] = useState(false);
  const typewriterTimerRef = useRef(null);
  const lockTimerRef = useRef(null);
  const enableTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (typewriterTimerRef.current) clearInterval(typewriterTimerRef.current);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      if (enableTimerRef.current) clearTimeout(enableTimerRef.current);
    };
  }, []);

  function appendCoachMessage(entry, opts = {}) {
    const lockAnswers = opts.lockAnswers ?? false;
    const optionsReadMs = opts.optionsReadMs ?? OPTIONS_READ_MIN_MS;
    const idx = display.length;
    setDisplay((d) => [...d, entry]);

    if (typewriterTimerRef.current) clearInterval(typewriterTimerRef.current);
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (enableTimerRef.current) clearTimeout(enableTimerRef.current);

    const text = entry.text || "";
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const totalMs = reduceMotion ? 0 : text.length * TYPEWRITER_CHAR_MS;

    if (lockAnswers) {
      setAnswersLocked(true);
      setAnswersEnabled(false);
    }

    if (reduceMotion) {
      setTypingIndex(null);
      setRevealedLength(text.length);
    } else {
      setTypingIndex(idx);
      setRevealedLength(0);
      const start = Date.now();
      typewriterTimerRef.current = setInterval(() => {
        const chars = Math.min(text.length, Math.floor((Date.now() - start) / TYPEWRITER_CHAR_MS));
        setRevealedLength(chars);
        if (chars >= text.length) {
          clearInterval(typewriterTimerRef.current);
          typewriterTimerRef.current = null;
          setTypingIndex(null);
        }
      }, TYPEWRITER_CHAR_MS);
    }

    if (lockAnswers) {
      const lockDuration = Math.max(TYPEWRITER_MIN_LOCK_MS, totalMs);
      gateMsAccumRef.current += lockDuration + optionsReadMs;
      lockTimerRef.current = setTimeout(() => {
        setAnswersLocked(false);
        lockTimerRef.current = null;
        // Second phase starts only once the first clears — the options
        // are now rendered (see the render conditions below) but stay
        // disabled and settling-in for this long before submitAnswer can
        // actually be called.
        enableTimerRef.current = setTimeout(() => {
          setAnswersEnabled(true);
          enableTimerRef.current = null;
        }, optionsReadMs);
      }, lockDuration);
    }
  }

  useEffect(() => {
    const t = setInterval(() => {
      if (wordStartRef.current && !wordDone) {
        setPacingElapsed(Math.floor((Date.now() - wordStartRef.current) / 1000));
      }
    }, 5000);
    return () => clearInterval(t);
  }, [wordDone]);

  const clueOptions = splitIntoChunks(getSentenceContaining(passage.text, targetWord.word));
  const contextSentence = getSentenceContaining(passage.text, targetWord.word);

  // No AI call here on purpose: this used to ask the model for a
  // one-sentence explanation, but the always-available fallback below
  // already fits the moment (the guided approach didn't work, hand off
  // to the teacher) just as well, for zero AI-quota cost.
  //
  // stageOverride: the auto-skip path (submitAnswer, below) calls this
  // right after a response comes back but before setCurrent(parsed) has
  // committed, so reading `current.stage` here would capture the stale,
  // pre-response value. Passing the stage explicitly avoids depending on
  // React state timing. The manual Skip button (no argument) doesn't
  // have this problem, since `current` is already up to date whenever a
  // student can see and click it.
  function skipWord(stageOverride, reason = "manual") {
    SFX.click();
    const revealText = `"${targetWord.word}" — ask your teacher to explain this one together!`;
    appendCoachMessage({ from: "coach", text: revealText, revealed: true });
    if (soundEnabled) setTimeout(() => speak(revealText), 300);
    setCurrent(null);
    setWordDone(true);
    skipTimeoutRef.current = setTimeout(() => {
      onWordResolved({
        word: targetWord.word,
        clueType: targetWord.clueType,
        concreteness: targetWord.concreteness,
        finalStage: stageOverride ?? (current ? current.stage : 1),
        hintsUsed: hintsUsedRef.current,
        funFact: null,
        revealedMeaning: revealText,
        skipped: true,
        // "manual" = student tapped Skip immediately; "stuck_limit" = they
        // kept trying for STUCK_WORD_LIMIT exchanges and never landed it —
        // distinct diagnostic signals for the teacher report, not the same
        // as giving up right away.
        skipReason: reason,
        solvedAt: Date.now(),
        passageTitle: passage.title,
        priorKnowledge,
        gotItVia: null,
        clueIdentified: null,
        transferPassed: null,
        timeToAnswerSec: wordStartRef.current ? Math.round((Date.now() - wordStartRef.current) / 1000) : null,
        minGateSec: Math.round(gateMsAccumRef.current / 1000),
      });
    }, 2200);
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [display, postPhase, transferData, activeSlide]);

  const slideGroups = groupMessagesByExchange(display);
  const isLatestSlide = activeSlide === slideGroups.length - 1;

  useEffect(() => {
    setActiveSlide(slideGroups.length - 1);
    // Only re-follow when a new slide actually appears, not on every
    // display update (e.g. mid-typewriter reveal) — otherwise a student
    // who stepped back to review an earlier exchange would get yanked
    // forward on every keystroke of the typewriter effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideGroups.length]);

  function handlePriorAnswer(value) {
    SFX.tap();
    setPriorKnowledge(value);
    setPrePhase("coaching");
    wordStartRef.current = Date.now();
    gateMsAccumRef.current = 0;
    startWord();
  }

  async function startWord() {
    unlockSpeechOnce();
    setLoading(true);
    setError(null);
    const openingMsg = `Passage: "${passage.text}"\n\nStart coaching for the target word "${targetWord.word}". Begin at Stage 1.`;
    const msgs = [{ role: "user", content: openingMsg }];
    try {
      const parsed = await callClaudeWithRetry("coach", { companionId: avatarConfig.companion, stage1Type, stage2Type, stage3Type }, msgs, MAX_RETRY_ATTEMPTS, (p) => validateCoachResponse(p, targetWord.word));
      setHistory([...msgs, { role: "assistant", content: JSON.stringify(parsed) }]);
      setCurrent(parsed);
      setStageReached(parsed.stage || 1);
      appendCoachMessage({ from: "coach", text: parsed.message, hint: parsed.hint_given, stage: parsed.stage }, { lockAnswers: true, optionsReadMs: computeOptionsReadMs(parsed) });
      if (parsed.hint_given) hintsUsedRef.current += 1;
      if (soundEnabled) setTimeout(() => speak(parsed.message), 300);
    } catch (e) {
      setError(`Oops, your coach got stuck! ${e && e.message ? e.message : ""} Try again.`);
    } finally {
      setLoading(false);
    }
  }

  // Closed-form input types have a knowable correct answer, so the app
  // checks them itself instead of asking an 8B model to remember and
  // re-judge its own multi-turns-ago question. Only "text" (genuinely
  // open-ended: fix-the-mistake, sentence completion, free sentence) has
  // no fixed answer key and stays an AI judgment call.
  function getCorrectAnswerForCurrent() {
    if (!current) return null;
    switch (current.input_type) {
      case "mcq":
      case "true_false":
      case "tap_select":
      case "reverse_clue":
        return typeof current.correct_answer === "string" ? current.correct_answer : null;
      case "word_bank":
      case "letter_connect":
        return targetWord.word;
      default:
        return null;
    }
  }

  // The screen-reader live region (below, in the render) needs to announce
  // whatever the student's actual next task is. Once a word is solved,
  // postPhase moves the UI through gotItVia/whichClue/transfer reflection
  // steps that are static JSX, never appended to `display` — without this,
  // the live region would go silent right after the "you got it!" message,
  // even though there's a new question on screen for a sighted student.
  function getReflectionAnnouncement() {
    if (postPhase === "gotItVia") return "How did you get it?";
    if (postPhase === "whichClue") return "Which part gave it away?";
    if (postPhase === "transfer") {
      if (transferLoading) return "One more check, a brand-new sentence…";
      if (transferData && transferPassed === null) return `Same word, new sentence, what does it mean here? ${transferData.sentence}`;
      if (transferPassed !== null) return transferPassed ? "Nailed it in a brand-new sentence!" : "That's okay, this one was tricky in a new sentence.";
    }
    return null;
  }

  async function submitAnswer(answerText, opts = {}) {
    if (!current) return;
    SFX.click();
    // A Retry after a failed call re-sends the same text that's already
    // the last bubble in `display` (see the error banner's Retry button
    // below) — don't append it again, or the student's answer shows up
    // twice in the transcript.
    if (!opts.isRetry) setDisplay((d) => [...d, { from: "student", text: answerText }]);
    setLoading(true);
    setError(null);
    const correctAnswer = getCorrectAnswerForCurrent();
    const isCorrect = correctAnswer !== null ? answerText.trim().toLowerCase() === correctAnswer.trim().toLowerCase() : null;
    let factNote = isCorrect === null ? "" : `\n[FACT: this answer is ${isCorrect ? "CORRECT" : "INCORRECT"}. Trust this, don't re-judge correctness yourself this turn.]`;
    // "text" answers have no fixed answer key, the model judges them itself
    // (see CORRECTNESS in the prompt) — but whether the target word was used
    // at all is checkable deterministically, so that one sub-question isn't
    // left entirely to a small model's judgment.
    if (isCorrect === null && current.input_type === "text" && !textLikelyContainsWord(answerText, targetWord.word)) {
      factNote += `\n[FACT: the answer does not contain the target word "${targetWord.word}" in any form.]`;
    }
    const newHistory = [...history, { role: "user", content: answerText + factNote }];
    try {
      const parsed = await callClaudeWithRetry("coach", { companionId: avatarConfig.companion, stage1Type, stage2Type, stage3Type }, newHistory, MAX_RETRY_ATTEMPTS, (p) => validateCoachResponse(p, targetWord.word));
      const updatedHistory = [...newHistory, { role: "assistant", content: JSON.stringify(parsed) }];
      setHistory(updatedHistory);
      if (parsed.hint_given) hintsUsedRef.current += 1;
      setStageReached(parsed.stage || 1);

      if (parsed.resolved) {
        SFX.resolved();
        appendCoachMessage({ from: "coach", text: parsed.message, hint: parsed.hint_given, stage: parsed.stage, resolved: true, funFact: parsed.fun_fact });
        setCurrent(null);
        if (soundEnabled) setTimeout(() => speak(parsed.message), 350);
        resolvedBaseRef.current = {
          word: targetWord.word,
          clueType: targetWord.clueType,
          concreteness: targetWord.concreteness,
          finalStage: parsed.stage,
          hintsUsed: hintsUsedRef.current,
          funFact: parsed.fun_fact,
          skipped: false,
          solvedAt: Date.now(),
          passageTitle: passage.title,
        };
        setTimeout(() => setPostPhase("gotItVia"), 1400);
      } else {
        exchangeCountRef.current += 1;
        if (exchangeCountRef.current >= STUCK_WORD_LIMIT) {
          // This word has gone STUCK_WORD_LIMIT exchanges without
          // resolving; auto-reveal via the same free fallback Skip uses
          // rather than let a genuinely stuck student keep spending AI
          // calls on a word that isn't landing. Pass parsed.stage
          // explicitly, see the stageOverride comment on skipWord().
          skipWord(parsed.stage || 1, "stuck_limit");
          return;
        }
        if (parsed.hint_given) { SFX.hint(); } else { SFX.correct(); }
        // Surfaces the adaptive engine's stage jumps instead of leaving them
        // silent: a confident answer that skips ahead 2 stages (see the
        // Adaptive rules in buildCoachSystemPrompt) reads very differently
        // from a normal 1-stage advance, and a drop-back after a wrong
        // answer deserves a gentler note, not just a hint bubble. Only
        // meaningful jumps get a badge (see the render below) -- a plain
        // 1-stage advance stays quiet so this doesn't add noise every turn.
        const stageJump = (parsed.stage || 1) - (current.stage || 1);
        appendCoachMessage({ from: "coach", text: parsed.message, hint: parsed.hint_given, stage: parsed.stage, stageJump }, { lockAnswers: true, optionsReadMs: computeOptionsReadMs(parsed) });
        setCurrent(parsed);
        if (soundEnabled) setTimeout(() => speak(parsed.message), 350);
      }
      setTextInput("");
    } catch (e) {
      setError(`Oops, your coach got stuck! ${e && e.message ? e.message : ""} Try again.`);
    } finally {
      setLoading(false);
    }
  }

  function handleGotItVia(value) {
    SFX.tap();
    setGotItVia(value);
    if (value === "clues") {
      setPostPhase("whichClue");
    } else {
      proceedAfterReflection(value, null);
    }
  }

  function handleWhichClue(chunk) {
    SFX.tap();
    setClueIdentified(chunk);
    proceedAfterReflection("clues", chunk);
  }

  function proceedAfterReflection(gotItViaValue, clueValue) {
    if (isTransferWord) {
      setPostPhase("transfer");
      runTransferTest(gotItViaValue, clueValue);
    } else {
      finalizeWord(gotItViaValue, clueValue, null);
    }
  }

  async function runTransferTest(gotItViaValue, clueValue) {
    setTransferLoading(true);
    try {
      const raw = await callClaude("transfer_test", null, [
        { role: "user", content: `Original passage: "${passage.text}"\n\nTarget word: "${targetWord.word}"` },
      ]);
      const parsed = safeParseJSON(raw);
      if (parsed && parsed.sentence && Array.isArray(parsed.options)) {
        setTransferData(parsed);
      } else {
        finalizeWord(gotItViaValue, clueValue, null);
      }
    } catch (e) {
      finalizeWord(gotItViaValue, clueValue, null);
    } finally {
      setTransferLoading(false);
    }
  }

  function handleTransferAnswer(opt, gotItViaValue, clueValue) {
    SFX.click();
    const passed = transferData && opt === transferData.correctAnswer;
    setTransferPassed(passed);
    SFX[passed ? "resolved" : "hint"]();
    setTimeout(() => finalizeWord(gotItViaValue, clueValue, passed), 1800);
  }

  function finalizeWord(gotItViaValue, clueValue, transferResult) {
    const base = resolvedBaseRef.current || {
      word: targetWord.word,
      clueType: targetWord.clueType,
      concreteness: targetWord.concreteness,
      finalStage: stageReached,
      hintsUsed: hintsUsedRef.current,
      funFact: null,
      skipped: false,
      solvedAt: Date.now(),
      passageTitle: passage.title,
    };
    setWordDone(true);
    onWordResolved({
      ...base,
      priorKnowledge,
      gotItVia: gotItViaValue,
      clueIdentified: clueValue,
      transferPassed: transferResult,
      timeToAnswerSec: wordStartRef.current ? Math.round((Date.now() - wordStartRef.current) / 1000) : null,
      minGateSec: Math.round(gateMsAccumRef.current / 1000),
    });
  }

  const companionEmoji = ANIMAL_COMPANIONS.find((c) => c.id === avatarConfig.companion)?.emoji || "🦜";
  // "text" spans 4 different stages (fill-blank, fix-mistake, continue,
  // free-sentence) with genuinely different tasks, so its own
  // INPUT_TYPE_INSTRUCTIONS entry is too generic ("Type your answer") to
  // be useful there -- fall back to the stage-specific instruction
  // instead. Every other input_type is pinned to exactly one stage
  // already (mcq/true_false only at 1, word_bank/letter_connect only at
  // 2, tap_select/reverse_clue only at 3), so its own instruction is
  // already the specific one.
  const instr = current ? (current.input_type === "text" ? STAGE_INSTRUCTIONS[current.stage] : INPUT_TYPE_INSTRUCTIONS[current.input_type]) : null;

  const StageTracker = () => (
    <div className="flex items-center justify-center gap-1.5 shrink-0">
      {[1, 2, 3, 4, 5].map((n) => {
        const done = wordDone || n < stageReached;
        const active = !wordDone && n === stageReached;
        return (
          <React.Fragment key={n}>
            {n > 1 && <div className="w-3 h-0.5 rounded-full" style={{ background: done ? "#0d9488" : "#d6d3d1" }} />}
            <div
              className="w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center font-display font-800 text-[10px] sm:text-xs shrink-0"
              style={{
                background: done ? "#0d9488" : "white",
                color: done ? "white" : active ? "#0d9488" : "#a8a29e",
                border: active ? "3px solid #0d9488" : done ? "none" : "2px solid #d6d3d1",
              }}
            >
              {done ? "✓" : n}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );

  const ReflectionButton = ({ children, onClick, ms }) => (
    <button
      onClick={onClick}
      className="w-full text-left px-5 py-3.5 bg-white rounded-2xl font-body font-800 text-lg text-stone-700 transition-all hover:scale-[1.02] active:scale-95"
      style={{ border: "3px solid #0d9488", boxShadow: "0 3px 0 0 #0f766e" }}
    >
      {children}
      {bilingual && ms && <span className="block font-body font-400 text-stone-500" style={{ fontSize: "0.75em" }}>{ms}</span>}
    </button>
  );

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "100dvh" }}>
      <div className="max-w-4xl mx-auto w-full px-5 pt-6 pb-3 flex-1 flex flex-col min-h-0 step-in">
        {/* Header card */}
        <div className="relative bg-white p-3 pl-14 mb-3 shrink-0" style={CARD_GOLD}>
          {wordDone && <Sparkle count={10} />}
          <div
            className="absolute -top-3 -left-3 z-20 bg-white rounded-2xl p-1"
            style={{ border: "3px solid #f59e0b", boxShadow: "0 3px 0 0 #c2410c" }}
          >
            <AvatarDisplay config={avatarConfig} size={44} />
          </div>

          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-800 text-stone-700 leading-tight">"{targetWord.word}"</h1>
              <p className="font-hand text-base sm:text-lg text-orange-700 leading-tight">{(COMPANION_PERSONAS[avatarConfig.companion] || COMPANION_PERSONAS.parrot).name} is tracking this word with you!</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 relative">
              <button
                onClick={() => skipWord()}
                disabled={loading || transferLoading}
                className="flex items-center gap-1 font-body text-xs text-stone-500 bg-white rounded-full px-3 py-2.5 hover:text-stone-700 disabled:opacity-40"
                style={{ border: "2px solid #d6d3d1" }}
                title="Skip this word and ask your teacher for help"
              >
                🙋 Skip
              </button>
              <button
                onClick={() => { SFX.tap(); setShowSettings((s) => !s); }}
                className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-lg"
                style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
                title="Settings"
                aria-label="Settings"
              >
                ⚙️
              </button>
              <button
                onClick={onBack}
                className="flex items-center gap-1 font-display font-700 text-sm text-stone-600 bg-white rounded-full px-3 py-2.5"
                style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>

              {showSettings && (
                <div
                  className="absolute top-12 right-0 z-30 bg-white rounded-2xl p-4 step-in"
                  style={{ border: "3px solid #d6d3d1", boxShadow: CARD_SHADOW, minWidth: "200px" }}
                >
                  <p className="font-display font-800 text-sm text-stone-600 mb-3">⚙️ Settings</p>
                  <button
                    onClick={() => onToggleSound(!soundOn)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-amber-50"
                    style={{ border: "2px solid #f59e0b" }}
                  >
                    <span className="font-body font-700 text-sm text-stone-700">Sound</span>
                    <span className="text-xl">{soundOn ? "🔊 On" : "🔇 Off"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-stone-100">
            <p className="font-display font-700 text-sm uppercase tracking-wide text-stone-600">
              {wordDone ? "Word complete!" : prePhase === "prior" ? "Getting ready…" : `Stage ${stageReached} of 5`}
            </p>
            <StageTracker />
          </div>
          {pacingElapsed > 60 && !wordDone && (
            <p className="font-body text-[11px] text-stone-500 text-center mt-2 step-in">⏱ Taking a bit longer than usual, that's okay!</p>
          )}
        </div>

        {/* Screen-reader-only announcement of the coach's message. The
            visible bubble below reveals it letter-by-letter for sighted
            students (typewriter effect), but m.text already holds the full
            final string from the moment it's appended, so this region's
            content only changes once per new message, not once per
            character — exactly one polite announcement per turn. */}
        <div className="sr-only" aria-live="polite" role="status">
          {getReflectionAnnouncement() || [...display].reverse().find((m) => m.from === "coach")?.text || ""}
        </div>

        {/* Single unified box */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-white p-5 sm:p-7 space-y-3"
          style={{ ...CARD_GOLD, maxHeight: "calc(100dvh - 225px)" }}
        >
          {prePhase === "prior" && (
            <div className="text-center py-4 step-in">
              <p className="text-5xl mb-3">🤔</p>
              <p className="font-hand text-2xl text-stone-500 mb-6">
                Have you seen the word "{targetWord.word}" before?
                {bilingual && <span className="block font-body text-stone-500" style={{ fontSize: "0.75em" }}>Pernahkah anda lihat perkataan ini sebelum ini?</span>}
              </p>
              <div className="flex flex-col gap-3 max-w-xs mx-auto">
                <ReflectionButton onClick={() => handlePriorAnswer("no")} ms="Tidak, ini baharu bagi saya">🆕 No, it's new to me</ReflectionButton>
                <ReflectionButton onClick={() => handlePriorAnswer("not_sure")} ms="Tidak pasti">🤷 Not sure</ReflectionButton>
                <ReflectionButton onClick={() => handlePriorAnswer("yes")} ms="Ya, saya tahu">✅ Yes, I know it</ReflectionButton>
              </div>
            </div>
          )}

          {prePhase === "coaching" && (
            <>
              {(slideGroups[activeSlide]?.items || []).map(({ msg: m, idx: i }) => (
                <div key={i} className={`flex ${m.from === "student" ? "justify-end" : "justify-start items-end gap-1.5"} step-in`}>
                  {m.from === "coach" && (
                    <span className="text-xl sm:text-2xl shrink-0 mb-1" title={(COMPANION_PERSONAS[avatarConfig.companion] || COMPANION_PERSONAS.parrot).name}>
                      {companionEmoji}
                    </span>
                  )}
                  <div
                    className={`relative max-w-[85%] px-4 py-3 sm:px-5 sm:py-3.5 rounded-2xl border-2 ${
                      m.from === "student"
                        ? "text-white border-teal-600"
                        : m.revealed
                        ? "text-stone-700 border-rose-300"
                        : m.resolved
                        ? "text-emerald-900 border-emerald-400"
                        : m.hint
                        ? "text-stone-700 border-amber-400 border-dashed"
                        : "text-stone-700 border-sky-300"
                    }`}
                    style={{
                      background:
                        m.from === "student"
                          ? "linear-gradient(135deg,#2dd4bf,#0d9488)"
                          : m.revealed
                          ? "linear-gradient(135deg,#fce7f3,#fbcfe8)"
                          : m.resolved
                          ? "linear-gradient(135deg,#d1fae5,#a7f3d0)"
                          : m.hint
                          ? "linear-gradient(135deg,#fef9c3,#fde68a)"
                          : "linear-gradient(135deg,#e0f2fe,#bae6fd)",
                    }}
                  >
                    {m.from === "coach" && (
                      <p className="font-display font-800 text-sm uppercase tracking-wide text-stone-500 mb-1.5">
                        {(COMPANION_PERSONAS[avatarConfig.companion] || COMPANION_PERSONAS.parrot).name}
                      </p>
                    )}
                    {typeof m.stageJump === "number" && m.stageJump >= 2 && !m.resolved && (
                      <>
                        <Sparkle count={6} />
                        <p className="font-hand text-lg sm:text-xl text-emerald-600 mb-1">⚡ great job, skipping ahead —</p>
                      </>
                    )}
                    {typeof m.stageJump === "number" && m.stageJump <= -1 && !m.resolved && (
                      <p className="font-hand text-lg sm:text-xl text-sky-600 mb-1">↩️ let's rebuild this one —</p>
                    )}
                    {m.hint && !m.resolved && <p className="font-hand text-lg sm:text-xl text-amber-600 mb-1">💡 here's a hint —</p>}
                    {m.revealed && <p className="font-hand text-lg sm:text-xl text-rose-500 mb-1">📖 here's the answer —</p>}
                    <div className="flex items-start gap-2">
                      <p className="font-body text-lg sm:text-xl leading-relaxed">
                        {i === typingIndex ? (
                          revealedLength === 0 ? (
                            <ThinkingDots label={`${(COMPANION_PERSONAS[avatarConfig.companion] || COMPANION_PERSONAS.parrot).name} is typing`} />
                          ) : (
                            <>
                              {m.text.slice(0, revealedLength)}
                              <span aria-hidden="true" className="inline-block w-[2px] h-[1em] bg-stone-400 align-middle ml-0.5 animate-pulse" />
                            </>
                          )
                        ) : (
                          m.text
                        )}
                      </p>
                      {m.from === "coach" && (
                        <button
                          onClick={() => speak(m.text)}
                          className="shrink-0 mt-0.5 w-11 h-11 rounded-full bg-white border-[3px] border-stone-300 flex items-center justify-center hover:border-teal-400 hover:bg-teal-50"
                          title="Read aloud"
                          aria-label="Read this message aloud"
                        >
                          🔊
                        </button>
                      )}
                    </div>
                    {m.resolved && m.funFact && (
                      <p className="font-body text-sm mt-2 pt-2 border-t border-emerald-300 text-emerald-700 flex items-start gap-1">
                        <Sparkles className="inline w-3.5 h-3.5 mt-0.5 shrink-0" /> {m.funFact}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {isLatestSlide && loading && typingIndex === null && (
                <div className="flex justify-start items-end gap-1.5">
                  <span className="text-xl sm:text-2xl shrink-0 mb-1">{companionEmoji}</span>
                  <div className="px-5 py-3.5 rounded-2xl bg-sky-50 border-2 border-sky-200">
                    <ThinkingDots label={`${(COMPANION_PERSONAS[avatarConfig.companion] || COMPANION_PERSONAS.parrot).name} is thinking`} />
                  </div>
                </div>
              )}

              {isLatestSlide && error && (
                <div className="border-2 border-rose-300 bg-rose-50 text-rose-600 font-body text-sm px-4 py-3 rounded-2xl flex items-center justify-between gap-2 step-in" aria-live="polite">
                  {error}
                  <BigButton variant="ghost" onClick={() => (history.length <= 1 ? startWord() : submitAnswer(display[display.length - 1]?.text || "", { isRetry: true }))}>
                    Retry
                  </BigButton>
                </div>
              )}

              {isLatestSlide && postPhase === null && !loading && current && (() => {
                const raw = (current.display_sentence && current.display_sentence.trim()) || contextSentence;
                const blank = current.stage === 2;
                // Stage 3 tap_select/text show the word used WRONG on
                // purpose, for the student to spot -- auto-bolding it
                // amber (the normal "here's the target word" treatment)
                // would visually point straight at the mistake before
                // they've even looked, undermining the actual task. Only
                // reverse_clue keeps the highlight, since its sentence
                // uses the word correctly and pointing it out doesn't
                // give away its answer (a different word, the clue).
                const wrongUsage = current.stage === 3 && current.input_type !== "reverse_clue";
                // The box's whole point differs by task -- a plain example
                // (Stage 1/4/5), a memory test with the word hidden (Stage
                // 2), a "something's off, find it" prompt (Stage 3
                // tap_select/text), or a "read closely for the clue" prompt
                // (Stage 3 reverse_clue) -- so it shouldn't wear the same
                // teal costume every time. Colors reuse INPUT_TYPE_ACCENT
                // so this box, the instruction badge, and the chip options
                // below all agree on one color per mechanic.
                const boxTheme = blank
                  ? { border: "#a8a29e", shadow: "#78716c", label: " — word hidden, this stage tests recall!", labelClass: "text-stone-600" }
                  : wrongUsage
                  ? { border: INPUT_TYPE_ACCENT.tap_select.border, shadow: INPUT_TYPE_ACCENT.tap_select.shadow, label: " — something's off here, can you spot it?", labelClass: "text-amber-700" }
                  : current.input_type === "reverse_clue"
                  ? { border: INPUT_TYPE_ACCENT.reverse_clue.border, shadow: INPUT_TYPE_ACCENT.reverse_clue.shadow, label: " — read closely for the clue", labelClass: "text-teal-700" }
                  : { border: "#0d9488", shadow: "#0f766e", label: "", labelClass: "text-teal-700" };
                return (
                  <div
                    className="px-5 py-4 rounded-2xl bg-white step-in"
                    style={{ border: `3px solid ${boxTheme.border}`, boxShadow: `0 4px 0 0 ${boxTheme.shadow}` }}
                  >
                    <p className={`font-display font-800 text-sm uppercase tracking-wide mb-1.5 ${boxTheme.labelClass}`}>
                      📖 From the passage{boxTheme.label}
                    </p>
                    <p className="font-body text-lg sm:text-xl text-stone-800 italic leading-snug font-700">
                      {wrongUsage
                        ? raw
                        : raw.split(new RegExp(`(${targetWord.word})`, "i")).map((part, i) =>
                            part.toLowerCase() === targetWord.word.toLowerCase() ? (
                              blank ? (
                                <strong key={i} className="text-stone-500 not-italic tracking-widest">▬▬▬▬▬</strong>
                              ) : (
                                <strong key={i} className="text-amber-700 not-italic font-800">{part}</strong>
                              )
                            ) : (
                              <span key={i}>{part}</span>
                            )
                          )}
                    </p>
                  </div>
                );
              })()}

              {isLatestSlide && postPhase === null && !loading && instr && (
                <div
                  className="flex items-center gap-2 rounded-2xl px-4 py-2.5 step-in border-4 border-white"
                  style={{ background: INPUT_TYPE_ACCENT[current.input_type]?.gradient || STAGE_GRADIENTS[current.stage] }}
                >
                  <span className="text-2xl sm:text-3xl">{instr.icon}</span>
                  <p className="font-display font-800 text-lg sm:text-xl text-white leading-tight" style={{ textShadow: "1px 1px 0 rgba(0,0,0,0.15)" }}>
                    {instr.text}
                  </p>
                </div>
              )}

              {isLatestSlide && postPhase === null && !loading && answersLocked && current && (
                <p className="font-hand text-base sm:text-lg text-stone-400 text-center" aria-hidden="true">
                  read the message, then answer below…
                </p>
              )}

              {isLatestSlide && postPhase === null && !loading && !answersLocked && current && current.input_type === "mcq" && current.options && (
                <div className={`grid grid-cols-1 gap-3 step-in answer-settle${answersEnabled ? " bounce-in" : ""}`} style={settlingStyle(answersEnabled)}>
                  {current.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => submitAnswer(opt)}
                      disabled={!answersEnabled}
                      className="text-left px-4 py-3.5 bg-white rounded-2xl hover:scale-[1.02] font-body font-800 text-lg sm:text-xl text-stone-700 transition-all"
                      style={{ border: "3px solid #d6d3d1", boxShadow: "0 3px 0 0 #a8a29e" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2dd4bf"; e.currentTarget.style.boxShadow = "0 3px 0 0 #0d9488"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d6d3d1"; e.currentTarget.style.boxShadow = "0 3px 0 0 #a8a29e"; }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {isLatestSlide && postPhase === null && !loading && !answersLocked && current && current.input_type === "true_false" && current.options && (
                <div className={`grid grid-cols-2 gap-3 step-in answer-settle${answersEnabled ? " bounce-in" : ""}`} style={settlingStyle(answersEnabled)}>
                  {current.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => submitAnswer(opt)}
                      disabled={!answersEnabled}
                      className="py-5 sm:py-7 rounded-2xl font-display font-800 text-xl sm:text-3xl text-white transition-all hover:scale-105"
                      style={{
                        background: opt.toLowerCase() === "true" ? "linear-gradient(180deg,#34d399,#059669)" : "linear-gradient(180deg,#fb7185,#e11d48)",
                        boxShadow: opt.toLowerCase() === "true" ? "0 5px 0 0 #065f46" : "0 5px 0 0 #9f1239",
                      }}
                    >
                      {opt.toLowerCase() === "true" ? "👍 " : "👎 "}{opt}
                    </button>
                  ))}
                </div>
              )}

              {isLatestSlide && postPhase === null && !loading && !answersLocked && current && (current.input_type === "tap_select" || current.input_type === "reverse_clue") && current.options && (() => {
                const accent = INPUT_TYPE_ACCENT[current.input_type];
                return (
                  <div
                    className={`flex flex-wrap gap-3 justify-center rounded-2xl p-3 step-in answer-settle${answersEnabled ? " bounce-in" : ""}`}
                    style={{ ...settlingStyle(answersEnabled), background: accent.soft }}
                  >
                    {current.options.map((word, i) => (
                      <button
                        key={i}
                        onClick={() => submitAnswer(word)}
                        disabled={!answersEnabled}
                        className="px-4 py-2.5 bg-white rounded-full font-display font-700 text-lg sm:text-xl text-stone-700 transition-all hover:scale-110"
                        style={{ border: `3px solid ${accent.border}`, boxShadow: `0 3px 0 0 ${accent.shadow}` }}
                      >
                        {word}
                      </button>
                    ))}
                  </div>
                );
              })()}

              {isLatestSlide && postPhase === null && !loading && !answersLocked && current && current.input_type === "word_bank" && current.word_tiles && (
                <div className={`answer-settle${answersEnabled ? " bounce-in" : ""}`} style={settlingStyle(answersEnabled)}>
                  <WordBankWidget key={current.stage + "-" + current.word_tiles.join("")} tiles={current.word_tiles} onSubmit={submitAnswer} disabled={!answersEnabled} />
                </div>
              )}

              {isLatestSlide && postPhase === null && !loading && !answersLocked && current && current.input_type === "letter_connect" && current.word_tiles && (
                <div className={`answer-settle${answersEnabled ? " bounce-in" : ""}`} style={settlingStyle(answersEnabled)}>
                  <LetterConnectWidget key={current.stage + "-" + current.word_tiles.join("")} tiles={current.word_tiles} onSubmit={submitAnswer} disabled={!answersEnabled} />
                </div>
              )}

              {isLatestSlide && postPhase === null && !loading && !answersLocked && current && current.input_type === "text" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!textInput.trim()) return;
                    const fullAnswer = current.sentence_starter
                      ? `${current.sentence_starter} ${textInput.trim()}`.trim()
                      : textInput.trim();
                    submitAnswer(fullAnswer);
                  }}
                  className={`flex flex-col gap-2 step-in answer-settle${answersEnabled ? " bounce-in" : ""}`}
                  style={settlingStyle(answersEnabled)}
                >
                  {current.sentence_starter && (
                    <div
                      className="flex items-center flex-wrap gap-2 bg-stone-50 rounded-2xl px-4 py-4"
                      style={{ border: "3px solid #d6d3d1" }}
                    >
                      <span className="font-body text-lg sm:text-xl text-stone-500 italic">{current.sentence_starter}</span>
                      <input
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        placeholder="…finish it here"
                        aria-label="Finish the sentence"
                        className="flex-1 min-w-[100px] bg-transparent font-body text-lg sm:text-xl text-stone-700 focus:outline-none"
                        autoFocus
                        disabled={!answersEnabled}
                      />
                    </div>
                  )}
                  {!current.sentence_starter && (
                    <input
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      placeholder="Type your answer…"
                      aria-label="Your answer"
                      className="w-full bg-white rounded-2xl border-3 border-stone-300 px-4 py-3.5 font-body text-lg sm:text-xl text-stone-700 focus:outline-none focus:border-teal-400"
                      style={{ borderWidth: "3px" }}
                      autoFocus
                      disabled={!answersEnabled}
                    />
                  )}
                  <BigButton
                    silent
                    onClick={() => {
                      if (!textInput.trim()) return;
                      const fullAnswer = current.sentence_starter
                        ? `${current.sentence_starter} ${textInput.trim()}`.trim()
                        : textInput.trim();
                      submitAnswer(fullAnswer);
                    }}
                    disabled={!textInput.trim() || !answersEnabled}
                  >
                    Send
                  </BigButton>
                </form>
              )}

              {postPhase === "gotItVia" && (
                <div className="text-center py-4 step-in">
                  <p className="font-hand text-2xl text-teal-600 mb-4">
                    How did you get it?
                  </p>
                  <div className="flex flex-col gap-3 max-w-xs mx-auto">
                    <ReflectionButton onClick={() => handleGotItVia("knew")} ms="Saya sudah tahu">💡 I already knew it</ReflectionButton>
                    <ReflectionButton onClick={() => handleGotItVia("clues")} ms="Saya guna petunjuk">🔍 I used the clues</ReflectionButton>
                    <ReflectionButton onClick={() => handleGotItVia("guessed")} ms="Saya meneka">🎲 I guessed</ReflectionButton>
                  </div>
                </div>
              )}

              {postPhase === "whichClue" && (
                <div className="text-center py-4 step-in">
                  <p className="font-hand text-2xl text-teal-600 mb-4">Which part gave it away?</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {clueOptions.map((chunk, i) => (
                      <button
                        key={i}
                        onClick={() => handleWhichClue(chunk)}
                        className="px-4 py-2.5 bg-white rounded-full font-display font-700 text-lg text-stone-700 transition-all hover:scale-110"
                        style={{ border: "3px solid #0d9488", boxShadow: "0 3px 0 0 #0f766e" }}
                      >
                        {chunk}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {postPhase === "transfer" && (
                <div className="step-in">
                  {transferLoading && (
                    <p className="font-hand text-2xl text-stone-500 text-center py-4">One more check, a brand-new sentence… 🧭</p>
                  )}
                  {!transferLoading && transferData && transferPassed === null && (
                    <>
                      <p className="font-hand text-xl text-teal-600 text-center mb-3">Same word, new sentence, what does it mean here?</p>
                      <div className="mb-4 p-4 rounded-2xl bg-teal-50" style={{ border: "3px solid #0d9488" }}>
                        <p className="font-body text-lg sm:text-xl text-stone-700">{transferData.sentence}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {transferData.options.map((opt, i) => (
                          <button
                            key={i}
                            onClick={() => handleTransferAnswer(opt, gotItVia, clueIdentified)}
                            className="text-left px-4 py-3 bg-white rounded-2xl hover:scale-[1.02] font-body font-800 text-lg text-stone-700 transition-all"
                            style={{ border: "3px solid #d6d3d1", boxShadow: "0 3px 0 0 #a8a29e" }}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {transferPassed !== null && (
                    <div
                      className="text-center p-5 rounded-2xl step-in bounce-in"
                      style={{ background: transferPassed ? "#d1fae5" : "#fee2e2", border: `3px solid ${transferPassed ? "#059669" : "#e11d48"}` }}
                    >
                      <p className="font-display font-800 text-xl text-stone-700">
                        {transferPassed ? "🎉 Nailed it in a brand-new sentence!" : "That's okay, this one was tricky in a new sentence."}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Slide navigation: one flashcard per exchange instead of a
            scrolling transcript. Only shown once there's more than one
            card to step between. */}
        {slideGroups.length > 1 && (
          <div className="flex items-center justify-center gap-3 mt-3 shrink-0">
            <button
              onClick={() => { SFX.tap(); setActiveSlide((s) => Math.max(0, s - 1)); }}
              disabled={activeSlide === 0}
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center disabled:opacity-30"
              style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
              aria-label="Previous card"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="font-body text-xs font-800 text-stone-500 min-w-[130px] text-center" aria-live="polite">
              {isLatestSlide ? "Current" : "Reviewing"} · card {activeSlide + 1} of {slideGroups.length}
            </p>
            <button
              onClick={() => { SFX.tap(); setActiveSlide((s) => Math.min(slideGroups.length - 1, s + 1)); }}
              disabled={isLatestSlide}
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center disabled:opacity-30"
              style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
              aria-label="Next card"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Teacher Screen ---------------- */
function BoldText({ text, className = "" }) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className={className}>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="text-amber-800">{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

// Builds a case-insensitive, whole-word regex matching any of `words`
// (longest first, so no word can shadow a longer one sharing a prefix).
// null if there's nothing to link — callers treat that as "don't linkify".
function buildWordLinkRegex(words) {
  const unique = [...new Set((words || []).filter(Boolean).map((w) => w.toLowerCase()))];
  if (unique.length === 0) return null;
  const escaped = unique.sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

// Splits `text` on wordLinkRegex and wraps any piece that's actually one
// of the known target words in a clickable button — the "click-to-
// evidence" affordance: every word the AI report mentions can be tapped
// to jump straight to that word's own row in the log table below, so a
// claim can be checked against the raw data instead of just trusted.
function linkifySegment(text, wordLinkRegex, wordSet, onWordClick, keyPrefix) {
  return text.split(wordLinkRegex).map((piece, j) =>
    piece && wordSet.has(piece.toLowerCase()) ? (
      <button
        key={`${keyPrefix}-${j}`}
        type="button"
        onClick={() => onWordClick(piece)}
        className="underline decoration-dotted decoration-2 underline-offset-2 hover:decoration-solid bg-transparent p-0 m-0 cursor-pointer font-inherit"
        style={{ color: "inherit" }}
        title={`Jump to "${piece}" in the word log`}
      >
        {piece}
      </button>
    ) : piece
  );
}

function renderInlineBold(text, boldColorClass, wordLinkRegex = null, wordSet = null, onWordClick = null) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const isBold = part.startsWith("**") && part.endsWith("**");
    const inner = isBold ? part.slice(2, -2) : part;
    const rendered = wordLinkRegex ? linkifySegment(inner, wordLinkRegex, wordSet, onWordClick, i) : inner;
    return isBold ? (
      <strong key={i} className={boldColorClass}>{rendered}</strong>
    ) : (
      <span key={i}>{rendered}</span>
    );
  });
}

function RichReportText({ text, className = "", boldColorClass = "text-inherit", linkWords = null, onWordClick = null }) {
  if (!text) return null;
  const wordLinkRegex = linkWords && onWordClick ? buildWordLinkRegex(linkWords) : null;
  const wordSet = wordLinkRegex ? new Set(linkWords.map((w) => w.toLowerCase())) : null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let seenHeadline = false;
  return (
    <div className={className}>
      {lines.map((line, i) => {
        const isBullet = /^[-•]\s*/.test(line);
        const content = line.replace(/^[-•]\s*/, "");
        if (isBullet) {
          return (
            <div key={i} className="flex items-start gap-2 mt-1.5">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-60" />
              <p className="text-[0.92em] leading-snug">{renderInlineBold(content, boldColorClass, wordLinkRegex, wordSet, onWordClick)}</p>
            </div>
          );
        }
        const isFirstHeadline = !seenHeadline;
        if (isFirstHeadline) seenHeadline = true;
        return (
          <p
            key={i}
            className={isFirstHeadline ? "font-display font-800 text-[1.08em] leading-snug mb-1" : "text-[0.95em] leading-relaxed mt-1.5"}
          >
            {renderInlineBold(content, boldColorClass, wordLinkRegex, wordSet, onWordClick)}
          </p>
        );
      })}
    </div>
  );
}

function stripBoldMarkers(text) {
  return (text || "").replace(/\*\*([^*]+)\*\*/g, "$1");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function getSentenceContaining(text, word) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const found = sentences.find((s) => s.toLowerCase().includes(word.toLowerCase()));
  return (found || sentences[0] || text).trim();
}

function splitIntoChunks(sentence) {
  return sentence
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function boldToHtml(text) {
  if (!text) return "";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let seenHeadline = false;
  let html = "";
  let inList = false;
  lines.forEach((line) => {
    const isBullet = /^[-•]\s*/.test(line);
    const content = escapeHtml(line.replace(/^[-•]\s*/, "")).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    if (isBullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${content}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      const isFirstHeadline = !seenHeadline;
      if (isFirstHeadline) seenHeadline = true;
      html += `<p class="${isFirstHeadline ? "headline" : ""}">${content}</p>`;
    }
  });
  if (inList) html += "</ul>";
  return html;
}

function buildReportHtml(studentId, log, summary) {
  const rows = log
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.word)}</td><td style="text-transform:capitalize">${escapeHtml(e.clueType)}</td><td>${e.finalStage} — ${escapeHtml(STAGE_LABELS[e.finalStage])}</td><td>${e.hintsUsed}</td><td>${e.skipped ? "Skipped" : ""}</td></tr>`
    )
    .join("");
  const sections = summary
    ? [
        { label: "📌 Summary", text: summary.summary, cls: "highlight" },
        { label: "🎯 The Pattern", text: summary.corePattern || summary.coreProblem, cls: "core" },
        { label: "🧠 How Reliable Is This", text: summary.howReliable, cls: "" },
        { label: "📖 Story Understanding", text: summary.storyUnderstandingNote, cls: "" },
        { label: "💡 What To Try in Class", text: summary.whatToTry, cls: "rec" },
      ]
    : [];
  const sectionsHtml = sections
    .filter((s) => s.text)
    .map((s) => `<div class="summary ${s.cls}"><h2>${s.label}</h2>${boldToHtml(s.text)}</div>`)
    .join("");
  return `<!DOCTYPE html>
<html>
<head>
<title>G.I.S.T. Report — ${escapeHtml(studentId)}</title>
<meta charset="utf-8" />
<meta name="color-scheme" content="light" />
<style>
  :root { color-scheme: light; }
  html, body { background: #fdfaf3; }
  body { font-family: Georgia, 'Times New Roman', serif; padding: 40px; color: #2a1a0f; max-width: 800px; margin: 0 auto; }
  h1 { color: #92400e; margin-bottom: 4px; }
  p { margin: 4px 0; }
  .table-wrap { margin-top: 20px; border: 3px solid #2563eb; border-radius: 20px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; background: #ffffff; }
  th, td { border: 1px solid #bfdbfe; padding: 8px 12px; text-align: left; font-size: 14px; background: #ffffff; color: #2a1a0f; }
  th { background: #dbeafe; }
  .summary { margin-top: 16px; padding: 16px; border: 2px dashed #0d9488; background: #f0fdfa; color: #2a1a0f; line-height: 1.7; font-size: 15px; }
  .summary.highlight { border-color: #0d9488; background: #ccfbf1; border-style: solid; border-width: 3px; font-size: 17px; }
  .summary.core { border-color: #dc2626; background: #fee2e2; border-width: 3px; }
  .summary.rec { border-color: #d97706; background: #fffbeb; }
  .summary h2 { font-size: 15px; margin: 0 0 8px 0; }
  .summary p { margin: 8px 0; }
  .summary p.headline { font-weight: 700; font-size: 1.1em; margin-top: 0; }
  .summary ul { margin: 4px 0 10px 0; padding-left: 20px; }
  .summary li { margin: 3px 0; }
  .hint { margin-top: 30px; font-size: 12px; color: #92400e; }
</style>
</head>
<body>
  <h1>G.I.S.T. — Explorer's Field Journal</h1>
  <p><strong>Student / Class:</strong> ${escapeHtml(studentId)}</p>
  <p><strong>Words logged this session:</strong> ${log.length}</p>
  ${sectionsHtml}
  <div class="table-wrap">
    <table>
      <thead><tr><th>Word</th><th>Clue Type</th><th>Stage Reached</th><th>Hints</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No words logged yet.</td></tr>'}</tbody>
    </table>
  </div>
  <p class="hint">Opened this file in your browser? Use your browser's own Print or Save-as-PDF option (usually Ctrl+P or Cmd+P) to print or save it.</p>
</body>
</html>`;
}

function downloadReport(studentId, log, summary) {
  try {
    const html = buildReportHtml(studentId, log, summary);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `GIST-report-${(studentId || "student").trim().replace(/\s+/g, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    return false;
  }
}


/* ---------------- Comprehension Screen ---------------- */
function ComprehensionScreen({ passage, avatarConfig, onDone, bilingual }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [correct, setCorrect] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const parsed = await callClaudeWithRetry(
          "comprehension",
          null,
          [{ role: "user", content: `Passage: "${passage.text}"` }],
          MAX_RETRY_ATTEMPTS,
          (p) => p && p.question && Array.isArray(p.options)
        );
        setData(parsed);
      } catch (e) {
        onDone({ ran: false });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line
  }, []);

  function handleAnswer(opt) {
    SFX.click();
    const isCorrect = data && opt === data.correctAnswer;
    setAnswer(opt);
    setCorrect(isCorrect);
    SFX[isCorrect ? "resolved" : "hint"]();
    setTimeout(() => {
      onDone({ ran: true, correct: isCorrect, question: data.question, studentAnswer: opt, correctAnswer: data.correctAnswer });
    }, 2200);
  }

  const companion = COMPANION_PERSONAS[avatarConfig.companion] || COMPANION_PERSONAS.parrot;
  const companionEmoji = ANIMAL_COMPANIONS.find((c) => c.id === avatarConfig.companion)?.emoji || "🦜";

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "100dvh" }}>
      <div className="max-w-3xl mx-auto w-full px-5 pt-6 pb-3 flex-1 flex flex-col min-h-0 step-in">
        {/* Header card, matching CoachScreen's identity */}
        <div className="relative bg-white p-3 pl-14 mb-3 shrink-0" style={CARD_GOLD}>
          <div
            className="absolute -top-3 -left-3 z-20 bg-white rounded-2xl p-1"
            style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
          >
            <AvatarDisplay config={avatarConfig} size={44} />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-800 text-stone-700 leading-tight">
            📖 One Last Check
            {bilingual && <span className="block font-body font-400 text-base text-stone-500">Semakan Terakhir</span>}
          </h1>
          <p className="font-hand text-base sm:text-lg text-orange-700 leading-tight">
            Did you follow the whole story, {passage.title}?
            {bilingual && <span className="block font-body text-stone-500" style={{ fontSize: "0.75em" }}>Adakah anda faham keseluruhan cerita ini?</span>}
          </p>
        </div>

        {/* Single unified box, matching CoachScreen */}
        <div
          className="flex-1 overflow-y-auto bg-white p-5 sm:p-7 space-y-4"
          style={{ ...CARD_GOLD, maxHeight: "calc(100dvh - 145px)" }}
        >
          {loading && (
            <div className="flex justify-start items-end gap-1.5 step-in">
              <span className="text-xl sm:text-2xl shrink-0 mb-1">{companionEmoji}</span>
              <div className="px-5 py-3.5 rounded-2xl bg-sky-50 border-2 border-sky-200">
                <p className="font-hand text-lg text-stone-500">{companion.name} is thinking of a question… 🧭</p>
              </div>
            </div>
          )}

          {!loading && data && (
            <div className="flex justify-start items-end gap-1.5 step-in">
              <span className="text-xl sm:text-2xl shrink-0 mb-1">{companionEmoji}</span>
              <div className="max-w-[85%] px-5 py-3.5 rounded-2xl bg-sky-50 border-2 border-sky-300">
                <p className="font-display font-800 text-sm uppercase tracking-wide text-stone-500 mb-1.5">{companion.name}</p>
                <p className="font-body text-lg sm:text-xl leading-relaxed text-stone-700">{data.question}</p>
              </div>
            </div>
          )}

          {!loading && data && answer === null && (
            <div className="grid grid-cols-1 gap-3 step-in">
              {data.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => handleAnswer(opt)}
                  className="text-left px-5 py-4 bg-white rounded-2xl hover:scale-[1.02] font-body font-800 text-lg sm:text-xl text-stone-700 transition-all"
                  style={{ border: "3px solid #d6d3d1", boxShadow: "0 3px 0 0 #a8a29e" }}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {!loading && data && answer !== null && (
            <div className="grid grid-cols-1 gap-3 step-in">
              {data.options.map((opt, i) => {
                const isCorrectOpt = opt === data.correctAnswer;
                const isChosen = opt === answer;
                const showState = isCorrectOpt || isChosen;
                return (
                  <div
                    key={i}
                    className="relative text-left px-5 py-4 rounded-2xl font-body font-800 text-lg sm:text-xl transition-all flex items-center justify-between"
                    style={{
                      border: `3px solid ${isCorrectOpt ? "#059669" : isChosen ? "#e11d48" : "#d6d3d1"}`,
                      background: isCorrectOpt ? "#d1fae5" : isChosen ? "#fee2e2" : "white",
                      color: showState ? "#292524" : "#78716c",
                      boxShadow: `0 3px 0 0 ${isCorrectOpt ? "#065f46" : isChosen ? "#9f1239" : "#a8a29e"}`,
                    }}
                  >
                    {opt}
                    {isCorrectOpt && <span>✓</span>}
                    {isChosen && !isCorrectOpt && <span>✗</span>}
                    {isChosen && isCorrectOpt && <Sparkle />}
                  </div>
                );
              })}
            </div>
          )}

          {answer !== null && (
            <div
              className="text-center p-5 rounded-2xl step-in bounce-in"
              style={{ background: correct ? "#d1fae5" : "#fee2e2", border: `3px solid ${correct ? "#059669" : "#e11d48"}` }}
            >
              <p className="font-display font-800 text-xl text-stone-700">
                {correct ? "🎉 You followed the whole story!" : "That's okay, stories can be tricky!"}
              </p>
              {!correct && (
                <p className="font-body text-sm text-stone-600 mt-2">The answer was: <strong>{data.correctAnswer}</strong></p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Student Recap Screen ---------------- */
function RecapScreen({ studentId, log, avatarConfig, comprehensionResult, onFinish }) {
  const solved = log.filter((e) => !e.skipped);
  const independent = solved.filter((e) => e.hintsUsed === 0);
  const withHelp = solved.filter((e) => e.hintsUsed > 0);
  const skipped = log.filter((e) => e.skipped);
  const realInference = solved.filter((e) => e.gotItVia === "clues");
  const clueTypeCounts = {};
  independent.forEach((e) => { clueTypeCounts[e.clueType] = (clueTypeCounts[e.clueType] || 0) + 1; });
  const bestClueType = Object.entries(clueTypeCounts).sort((a, b) => b[1] - a[1])[0];
  const transferWord = log.find((e) => e.transferPassed !== null && e.transferPassed !== undefined);

  const companion = COMPANION_PERSONAS[avatarConfig.companion] || COMPANION_PERSONAS.parrot;
  const companionEmoji = ANIMAL_COMPANIONS.find((c) => c.id === avatarConfig.companion)?.emoji || "🦜";

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 step-in relative min-h-screen flex flex-col justify-center">
      <FloatingDecor density={6} />
      <Confetti />
      <div className="bg-white p-6 sm:p-8 relative z-10 text-center" style={{ ...CARD_GOLD, boxShadow: CARD_SHADOW_HERO }}>
        <div className="flex items-center justify-center gap-3 mb-2">
          <AvatarDisplay config={avatarConfig} size={64} />
          <span className="text-5xl">{companionEmoji}</span>
        </div>
        <h1 className="font-display font-800 text-3xl text-stone-700 mt-2 mb-1">
          Great adventure, {studentId}!
        </h1>
        <p className="font-hand text-xl text-orange-700 mb-6">
          Here's what you got good at today
        </p>

        <div className="grid grid-cols-2 gap-3 mb-5 text-left step-in" style={{ animationDelay: "0.1s" }}>
          <div className="p-4 rounded-2xl bg-emerald-50" style={{ border: "3px solid #34d399" }}>
            <p className="font-display font-800 text-2xl text-emerald-700">{independent.length}</p>
            <p className="font-body text-xs text-stone-500">words solved on your own</p>
          </div>
          <div className="p-4 rounded-2xl bg-amber-50" style={{ border: "3px solid #fbbf24" }}>
            <p className="font-display font-800 text-2xl text-amber-700">{withHelp.length}</p>
            <p className="font-body text-xs text-stone-500">words solved with a hint</p>
          </div>
        </div>

        {bestClueType && (
          <div className="mb-4 p-4 rounded-2xl bg-teal-50 text-left step-in" style={{ border: "3px solid #0d9488", animationDelay: "0.2s" }}>
            <p className="font-body text-base text-stone-700">
              🌟 You're great at spotting <b className="font-display">{bestClueType[0]}</b> clues!
            </p>
          </div>
        )}

        {realInference.length > 0 && (
          <div className="mb-4 p-4 rounded-2xl bg-sky-50 text-left step-in" style={{ border: "3px solid #7dd3fc", animationDelay: "0.3s" }}>
            <p className="font-body text-base text-stone-700">
              🔍 You used context clues (not guessing!) on <b>{realInference.length}</b> word{realInference.length === 1 ? "" : "s"} today.
            </p>
          </div>
        )}

        {transferWord && (
          <div className="mb-4 p-4 rounded-2xl text-left step-in" style={{ background: transferWord.transferPassed ? "#d1fae5" : "#fef3c7", border: `3px solid ${transferWord.transferPassed ? "#059669" : "#d97706"}`, animationDelay: "0.4s" }}>
            <p className="font-body text-base text-stone-700">
              {transferWord.transferPassed
                ? <>🏆 You used <b>"{transferWord.word}"</b> correctly even in a brand-new sentence!</>
                : <>💪 <b>"{transferWord.word}"</b> in a new sentence was tricky, keep practicing that one!</>}
            </p>
          </div>
        )}

        {comprehensionResult && comprehensionResult.ran && (
          <div className="mb-4 p-4 rounded-2xl text-left step-in" style={{ background: comprehensionResult.correct ? "#d1fae5" : "#fee2e2", border: `3px solid ${comprehensionResult.correct ? "#059669" : "#e11d48"}`, animationDelay: "0.5s" }}>
            <p className="font-body text-base text-stone-700">
              {comprehensionResult.correct ? "📖 You followed the whole story too!" : "📖 The story itself was a bit tricky, ask your teacher about it!"}
            </p>
          </div>
        )}

        {skipped.length > 0 && (
          <div className="mb-4 p-4 rounded-2xl bg-rose-50 text-left step-in" style={{ border: "3px solid #fb7185", animationDelay: "0.6s" }}>
            <p className="font-body text-base text-stone-700">
              🙋 {skipped.length} word{skipped.length === 1 ? "" : "s"} you asked your teacher about, that's a smart move when something's tricky!
            </p>
          </div>
        )}

        <p className="font-hand text-lg text-stone-500 my-4">{companion.name} says: nice work today, explorer!</p>

        <BigButton onClick={onFinish}>
          Back to the map <ArrowRight className="inline w-4 h-4 ml-1" />
        </BigButton>
      </div>
    </div>
  );
}

// Small slack margin (seconds) on top of the enforced pacing-gate floor
// so answering just after the floor, rather than exactly on it, isn't
// treated as a false positive — real reading/clicking always costs a
// little more than the bare minimum even at genuine speed.
const GATE_FLOOR_SLACK_SEC = 2;

// True when a resolved word's total time barely exceeds the pacing
// gate's enforced minimum for that word (see gateMsAccumRef in
// CoachScreen) — i.e. the student had essentially no time to actually
// read the options beyond the hold the UI already forces, a signal the
// diagnostic report can use to flag that specific answer as a guess
// rather than a not-generalize-worthy comment on the whole session.
function answeredAtGateFloor(entry) {
  if (!entry || entry.skipped) return false;
  if (entry.timeToAnswerSec == null || entry.minGateSec == null) return false;
  return entry.timeToAnswerSec <= entry.minGateSec + GATE_FLOOR_SLACK_SEC;
}

// Picks the single weakest clue type from a breakdown (as returned by
// computeAtAGlance or the server's matching computeStatsBreakdown), for
// the cross-session and class-rollup callouts. Requires at least minTotal
// attempts of that type before it's eligible, so one unlucky word doesn't
// get reported as "a pattern" -- a single data point is noise, not
// evidence, and this tool's whole premise is not over-claiming.
function weakestClueType(breakdown, minTotal = 2) {
  const eligible = (breakdown || []).filter((b) => b.total >= minTotal);
  if (eligible.length === 0) return null;
  return eligible.reduce((worst, b) => (b.independent / b.total < worst.independent / worst.total ? b : worst));
}

function computeAtAGlance(log) {
  const solved = log.filter((e) => !e.skipped);
  const independent = solved.filter((e) => e.hintsUsed === 0).length;
  const withHelp = solved.filter((e) => e.hintsUsed > 0).length;
  const skipped = log.filter((e) => e.skipped);
  const clueTypes = ["contrast", "definition", "example", "inference"];
  const breakdown = clueTypes
    .map((ct) => {
      const words = log.filter((e) => e.clueType === ct && !e.skipped);
      const indep = words.filter((e) => e.hintsUsed === 0).length;
      return { type: ct, total: words.length, independent: indep };
    })
    .filter((b) => b.total > 0);
  return { total: log.length, independent, withHelp, skipped, breakdown };
}

const SAMPLE_LOG = [
  { word: "brave", clueType: "contrast", concreteness: "abstract", finalStage: 2, hintsUsed: 0, skipped: false, priorKnowledge: "no", gotItVia: "clues", clueIdentified: "but she says they are", transferPassed: null, timeToAnswerSec: 18, passageTitle: "Pet Show Day", solvedAt: Date.now() - 500000 },
  { word: "camouflage", clueType: "definition", concreteness: "abstract", finalStage: 4, hintsUsed: 1, skipped: false, priorKnowledge: "not_sure", gotItVia: "clues", clueIdentified: "helps them hide from enemies", transferPassed: true, timeToAnswerSec: 35, passageTitle: "Pet Show Day", solvedAt: Date.now() - 400000 },
  { word: "timid", clueType: "inference", concreteness: "abstract", finalStage: 1, hintsUsed: 0, skipped: false, priorKnowledge: "no", gotItVia: "guessed", clueIdentified: null, transferPassed: null, timeToAnswerSec: 6, passageTitle: "Pet Show Day", solvedAt: Date.now() - 300000 },
  { word: "clever", clueType: "example", concreteness: "abstract", finalStage: 5, hintsUsed: 0, skipped: false, priorKnowledge: "yes", gotItVia: "knew", clueIdentified: null, transferPassed: null, timeToAnswerSec: 4, passageTitle: "Pet Show Day", solvedAt: Date.now() - 200000 },
  { word: "playful", clueType: "example", concreteness: "abstract", finalStage: 1, hintsUsed: 0, skipped: true, revealedMeaning: "\"playful\" means enjoying fun and games.", priorKnowledge: "no", gotItVia: null, clueIdentified: null, transferPassed: null, timeToAnswerSec: 22, passageTitle: "Pet Show Day", solvedAt: Date.now() - 100000 },
];

const SAMPLE_COMPREHENSION = {
  ran: true,
  correct: true,
  question: "Why was Ali's dog considered clever?",
  studentAnswer: "It could open doors by itself",
  correctAnswer: "It could open doors by itself",
};

function TourScreen({ avatarConfig, passage, onDone, bilingual, onToggleBilingual, standalone = false }) {
  const [page, setPage] = useState(0);
  const [revealDemo, setRevealDemo] = useState(false);
  const [practiceAnswer, setPracticeAnswer] = useState(null);
  const companion = COMPANION_PERSONAS[avatarConfig.companion] || COMPANION_PERSONAS.parrot;
  const companionEmoji = ANIMAL_COMPANIONS.find((c) => c.id === avatarConfig.companion)?.emoji || "🦜";

  const practiceData = {
    sentence: "The lion was very fierce and roared loudly.",
    word: "fierce",
    question: "What does \"fierce\" mean here?",
    options: ["Wild and scary", "Very calm and gentle", "Sleepy and tired", "Small and quiet"],
    correctAnswer: "Wild and scary",
  };

  function handlePracticeAnswer(opt) {
    if (practiceAnswer) return;
    SFX.click();
    setPracticeAnswer(opt);
    SFX[opt === practiceData.correctAnswer ? "resolved" : "hint"]();
  }

  const Bi = ({ en, ms, className = "font-body text-base text-stone-600 leading-relaxed" }) => (
    <p className={className}>
      {en}
      {bilingual && ms && <span className="block font-body text-stone-500 mt-1" style={{ fontSize: "0.78em" }}>{ms}</span>}
    </p>
  );

  const pages = [
    // Page 1: Meet your coach
    {
      emoji: companionEmoji,
      title: `Meet ${companion.name}!`,
      titleMs: `Jom kenali ${companion.name}!`,
      body: (
        <>
          <Bi
            en={`${companion.name} will be your coach for this whole adventure, guiding you to work out each tricky word yourself.`}
            ms={`${companion.name} akan menjadi jurulatih anda sepanjang pengembaraan ini, membantu anda memahami setiap perkataan sukar sendiri.`}
            className="font-body text-base text-stone-600 leading-relaxed mb-3"
          />
          <div className="flex items-start gap-1.5 justify-start max-w-xs mx-auto mb-3">
            <span className="text-xl shrink-0">{companionEmoji}</span>
            <div className="px-3 py-2.5 rounded-2xl bg-sky-50 text-left" style={{ border: "2px solid #7dd3fc" }}>
              <p className="font-display font-800 text-[9px] uppercase tracking-wide text-stone-500 mb-0.5">{companion.name}</p>
              <p className="font-body text-xs sm:text-sm text-stone-700">
                Let's figure out what this word means together!
                {bilingual && <span className="block text-stone-500 mt-0.5" style={{ fontSize: "0.85em" }}>Jom kita fikirkan bersama apa maksud perkataan ini!</span>}
              </p>
            </div>
          </div>
          <Bi
            en={`${companion.name} will never just tell you the answer, you'll always get there through clues and questions!`}
            ms={`${companion.name} tidak akan terus bagi jawapan, anda akan sampai ke situ melalui petunjuk dan soalan!`}
          />
        </>
      ),
    },
    // Page 2: Read the story first, genuinely tappable demo
    {
      emoji: passage?.emoji || "📖",
      title: passage ? `Read "${passage.title}" first` : "Read the story first",
      titleMs: "Baca cerita dahulu",
      body: (
        <>
          <Bi
            en="The story appears one part at a time. Try tapping the locked part below!"
            ms="Cerita akan muncul sedikit demi sedikit. Cuba ketik bahagian berkunci di bawah!"
            className="font-body text-base text-stone-600 leading-relaxed mb-3"
          />
          <div className="text-left max-w-xs mx-auto mb-3 space-y-1.5">
            <div className="px-3 py-2 rounded-xl bg-white font-body text-xs text-stone-600" style={{ border: "3px solid #d6d3d1" }}>
              The robot was very{" "}
              <span className="font-display font-800 px-2 py-0.5 rounded-full inline-block" style={{ background: "linear-gradient(135deg,#fde68a,#fdba74)", boxShadow: "0 2px 0 0 #d97706" }}>
                amazing
              </span>
              .
            </div>
            {!revealDemo ? (
              <button
                onClick={() => { SFX.pageTurn(); setRevealDemo(true); }}
                className="w-full text-left px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 transition-all font-hand text-xs text-stone-600 italic"
              >
                🔒 tap to reveal the next part…
              </button>
            ) : (
              <div className="px-3 py-2 rounded-xl bg-white step-in bounce-in font-body text-xs text-stone-600" style={{ border: "3px solid #d6d3d1" }}>
                It could even{" "}
                <span className="font-display font-800 px-2 py-0.5 rounded-full inline-block" style={{ background: "linear-gradient(135deg,#fde68a,#fdba74)", boxShadow: "0 2px 0 0 #d97706" }}>
                  invent
                </span>{" "}
                new games!
              </div>
            )}
          </div>
          <Bi
            en="Tricky words light up once you've read their sentence, that's when you can tap them to start solving."
            ms="Perkataan sukar akan menyala selepas anda baca ayatnya, itu masa anda boleh ketik untuk mula menyelesaikannya."
          />
        </>
      ),
    },
    // Page 3 (NEW): How am I doing? — explains the reflection prompts before they're encountered live
    {
      emoji: "🤔",
      title: "How am I doing?",
      titleMs: "Macam mana prestasi saya?",
      body: (
        <>
          <Bi
            en="Sometimes your coach asks how you got an answer."
            ms="Kadang-kadang jurulatih anda akan tanya macam mana anda dapat jawapan itu."
            className="font-body text-base text-stone-600 leading-relaxed mb-3"
          />
          <div className="flex flex-col gap-1.5 max-w-xs mx-auto mb-3">
            <div className="px-3 py-1.5 rounded-xl bg-white font-body text-[11px] text-stone-600 text-left" style={{ border: "2px solid #0d9488" }}>💡 I already knew it</div>
            <div className="px-3 py-1.5 rounded-xl bg-white font-body text-[11px] text-stone-600 text-left" style={{ border: "2px solid #0d9488" }}>🔍 I used the clues</div>
            <div className="px-3 py-1.5 rounded-xl bg-white font-body text-[11px] text-stone-600 text-left" style={{ border: "2px solid #0d9488" }}>🎲 I guessed</div>
          </div>
          <Bi
            en="There's no wrong answer to that question, just be honest!"
            ms="Tiada jawapan yang salah untuk soalan itu, jujur sahaja!"
          />
        </>
      ),
    },
    // Page 4 (NEW): Questions can change — explains stage adaptation
    {
      emoji: "🎯",
      title: "Questions can change",
      titleMs: "Soalan boleh berubah",
      body: (
        <>
          <Bi
            en="Get it right away? Questions might get trickier."
            ms="Dapat betul terus? Soalan mungkin jadi lebih mencabar."
            className="font-body text-base text-stone-600 leading-relaxed mb-3"
          />
          <div className="flex items-center justify-center gap-1.5 mb-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="w-7 h-7 rounded-full bg-teal-600 text-white font-display font-800 text-xs flex items-center justify-center">
                {n}
              </div>
            ))}
          </div>
          <Bi
            en="Need a hint? They'll get easier. Your coach adjusts just for you!"
            ms="Perlukan bantuan? Ia akan jadi lebih mudah. Jurulatih anda sesuaikan khas untuk anda!"
          />
        </>
      ),
    },
    // Page 5: A playable practice question, fixed and instant, so it's identical every time
    {
      emoji: "🎮",
      title: `Try "${practiceData.word}"!`,
      titleMs: `Cuba "${practiceData.word}"!`,
      body: (
        <div className="text-left">
          <div className="mb-3 px-3 py-2.5 rounded-xl bg-white font-body text-xs sm:text-sm text-stone-700 italic" style={{ border: "2px solid #0d9488" }}>
            {practiceData.sentence}
          </div>
          <p className="font-body text-sm sm:text-base text-stone-700 mb-2.5">{practiceData.question}</p>
          <div className="grid grid-cols-1 gap-1.5">
            {practiceData.options.map((opt, i) => {
              const isCorrect = opt === practiceData.correctAnswer;
              const isChosen = opt === practiceAnswer;
              const answered = !!practiceAnswer;
              return (
                <button
                  key={i}
                  onClick={() => handlePracticeAnswer(opt)}
                  className="text-left px-3 py-2 rounded-xl font-body text-xs sm:text-sm transition-all"
                  style={{
                    border: `3px solid ${answered && isCorrect ? "#059669" : answered && isChosen ? "#e11d48" : "#d6d3d1"}`,
                    background: answered && isCorrect ? "#d1fae5" : answered && isChosen ? "#fee2e2" : "white",
                    color: answered && !isCorrect && !isChosen ? "#a8a29e" : "#292524",
                  }}
                >
                  {opt} {answered && isCorrect && "✓"} {answered && isChosen && !isCorrect && "✗"}
                </button>
              );
            })}
          </div>
          {practiceAnswer && (
            <p className="font-hand text-base text-teal-600 mt-3 text-center step-in">
              Nice! That's exactly how it'll feel when you play for real.
              {bilingual && <span className="block font-body text-stone-500 mt-1" style={{ fontSize: "0.7em" }}>Bagus! Begitulah rasanya apabila anda bermain nanti.</span>}
            </p>
          )}
        </div>
      ),
    },
    // Page 6 (NEW): More ways to answer — a quick heads-up, not a full lesson
    {
      emoji: "🎲",
      title: "More ways to answer",
      titleMs: "Lebih banyak cara untuk jawab",
      body: (
        <>
          <Bi
            en="Sometimes you'll type, sometimes you'll tap letters, sometimes true or false!"
            ms="Kadang-kadang anda taip, kadang-kadang ketik huruf, kadang-kadang betul atau salah!"
            className="font-body text-base text-stone-600 leading-relaxed mb-3"
          />
          <div className="flex items-center justify-center gap-3 mb-3 text-2xl">
            <span>👉</span>
            <span>✍️</span>
            <span>🔤</span>
            <span>🤔</span>
            <span>🕵️</span>
          </div>
          <Bi
            en="Your coach mixes it up to keep things fun."
            ms="Jurulatih anda ubah-ubah supaya seronok."
          />
        </>
      ),
    },
    // Page 7: Finishing up
    {
      emoji: "🏁",
      title: "Finishing up",
      titleMs: "Hampir selesai",
      body: (
        <>
          <Bi
            en="Once you've solved every word, there's one more question about the whole story, then you'll see what you did well!"
            ms="Selepas anda selesaikan semua perkataan, ada satu lagi soalan tentang keseluruhan cerita, kemudian anda akan lihat apa yang anda kuasai!"
            className="font-body text-base text-stone-600 leading-relaxed mb-3"
          />
          <div className="flex gap-2 justify-center mb-3">
            <div className="px-4 py-2 rounded-xl bg-emerald-50 text-center" style={{ border: "2px solid #34d399" }}>
              <p className="font-display font-800 text-lg text-emerald-700 leading-none">3</p>
              <p className="font-body text-[9px] text-stone-500">solved alone</p>
            </div>
            <div className="px-4 py-2 rounded-xl bg-amber-50 text-center" style={{ border: "2px solid #fbbf24" }}>
              <p className="font-display font-800 text-lg text-amber-700 leading-none">2</p>
              <p className="font-body text-[9px] text-stone-500">with a hint</p>
            </div>
          </div>
          <Bi
            en={<>Stuck on a word? Tap <b>"🙋 Skip"</b> anytime to ask your teacher for help, that's always okay.</>}
            ms="Tersekat pada satu perkataan? Ketik &quot;🙋 Skip&quot; bila-bila masa untuk minta bantuan guru, itu sentiasa okay."
          />
        </>
      ),
    },
  ];

  // The first-time flow shows the tour before the name/avatar/story wizard,
  // so it needs one more page bridging into that setup instead of straight
  // into gameplay. A replay from "How to play" skips this, it just ends.
  if (!standalone) {
    pages.push({
      emoji: "🎒",
      title: "Ready to set up your adventure!",
      titleMs: "Sedia untuk sediakan pengembaraan anda!",
      body: (
        <Bi
          en="Next, you'll pick your name, choose your animal coach, and pick a story to explore."
          ms="Seterusnya, pilih nama anda, pilih jurulatih haiwan anda, dan pilih cerita untuk diterokai."
          className="font-body text-base text-stone-600 leading-relaxed"
        />
      ),
    });
  }

  const totalPages = pages.length;
  const current = pages[page];

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 step-in relative min-h-screen flex flex-col justify-center">
      <FloatingDecor density={5} />
      <div className="bg-white p-6 sm:p-8 relative z-10 text-center max-h-[92dvh] overflow-y-auto" style={CARD_GOLD}>
        <button
          onClick={onDone}
          className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 flex items-center gap-1 px-3 py-1.5 rounded-full bg-white font-display font-700 text-xs text-stone-500 hover:text-stone-700 hover:border-stone-400 transition-all"
          style={{ border: "2px solid #d6d3d1" }}
        >
          Skip tutorial ✕
        </button>

        {onToggleBilingual && (
          <button
            onClick={onToggleBilingual}
            className="absolute top-3 left-3 sm:top-4 sm:left-4 z-20 flex items-center rounded-full bg-white overflow-hidden font-display font-800 text-xs"
            style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
            title={bilingual ? "Turn off Bahasa Malaysia support" : "Turn on Bahasa Malaysia support"}
          >
            <span className={`px-2.5 py-1.5 ${!bilingual ? "bg-amber-400 text-amber-900" : "text-stone-500"}`}>EN</span>
            <span className={`px-2.5 py-1.5 ${bilingual ? "bg-amber-400 text-amber-900" : "text-stone-500"}`}>BM</span>
          </button>
        )}

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 mb-6 flex-wrap">
          {Array.from({ length: totalPages }).map((_, i) => (
            <div
              key={i}
              className={`h-2.5 rounded-full transition-all ${
                i === page ? "w-8 bg-orange-400" : i < page ? "w-2.5 bg-emerald-400" : "w-2.5 bg-stone-200"
              }`}
            />
          ))}
        </div>

        <span className="text-5xl">{current.emoji}</span>
        <h1 className="font-display font-800 text-2xl text-stone-700 mt-2 mb-4">
          {current.title}
          {bilingual && current.titleMs && <span className="block font-body font-400 text-base text-stone-500 mt-0.5">{current.titleMs}</span>}
        </h1>

        <div className="min-h-[200px] flex flex-col justify-center mb-6">{current.body}</div>

        <div className="flex items-center justify-center gap-3">
          {page > 0 && (
            <BigButton variant="ghost" onClick={() => { SFX.tap(); setPage((p) => p - 1); }}>
              <ChevronLeft className="inline w-4 h-4 mr-1" /> Back
            </BigButton>
          )}
          {page < totalPages - 1 ? (
            <BigButton onClick={() => { SFX.tap(); setPage((p) => p + 1); }}>
              Next <ArrowRight className="inline w-4 h-4 ml-1" />
            </BigButton>
          ) : (
            <BigButton onClick={onDone}>
              {standalone ? "Got it!" : "Let's start!"} <ArrowRight className="inline w-4 h-4 ml-1" />
            </BigButton>
          )}
        </div>
      </div>
    </div>
  );
}

// Placeholder shaped like the real diagnostic report (same section colors
// and layout, pulsing bars instead of text) shown while it's generating,
// instead of leaving that whole area blank with only the button's label
// changed. aria-hidden since it carries no real information for screen
// readers to announce.
function DiagnosticReportSkeleton() {
  const bar = (widthClass, toneClass) => <div className={`h-3 ${widthClass} ${toneClass} rounded-full animate-pulse`} />;
  return (
    <div className="relative z-10 mb-6 space-y-4 step-in" aria-hidden="true">
      <div className="p-7 rounded-3xl space-y-2.5" style={{ background: "linear-gradient(135deg,#ccfbf1,#99f6e4)", border: "4px solid #0d9488" }}>
        {bar("w-24 mx-auto", "bg-teal-400/50")}
        {bar("w-full h-4", "bg-teal-400/40")}
        {bar("w-3/4 mx-auto h-4", "bg-teal-400/40")}
      </div>
      <div className="p-6 rounded-3xl space-y-2.5" style={{ background: "#fee2e2", border: "4px solid #dc2626" }}>
        {bar("w-32 mx-auto", "bg-red-300/60")}
        {bar("w-full", "bg-red-300/40")}
        {bar("w-4/5 mx-auto", "bg-red-300/40")}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-5 rounded-3xl space-y-2.5" style={{ background: "#dbeafe", border: "3px solid #2563eb" }}>
          {bar("w-24", "bg-blue-300/60")}
          {bar("w-full", "bg-blue-300/40")}
          {bar("w-4/5", "bg-blue-300/40")}
        </div>
        <div className="p-5 rounded-3xl space-y-2.5" style={{ background: "#dbeafe", border: "3px solid #2563eb" }}>
          {bar("w-28", "bg-blue-300/60")}
          {bar("w-full", "bg-blue-300/40")}
          {bar("w-3/5", "bg-blue-300/40")}
        </div>
      </div>
      <div className="p-6 rounded-3xl space-y-2.5" style={{ background: "#fef3c7", border: "4px solid #d97706" }}>
        {bar("w-36 mx-auto", "bg-amber-300/60")}
        {bar("w-full", "bg-amber-300/40")}
        {bar("w-4/5 mx-auto", "bg-amber-300/40")}
      </div>
      <div className="p-6 rounded-3xl space-y-2.5" style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)", border: "4px solid #d97706" }}>
        {bar("w-40 mx-auto", "bg-amber-400/60")}
        {bar("w-full", "bg-amber-400/40")}
        {bar("w-3/5 mx-auto", "bg-amber-400/40")}
      </div>
    </div>
  );
}

function TeacherScreen({ studentId, realStudentId = null, log, onBack, onReset, sessionStartedAt, comprehensionResult, isDemo = false, initialSummary = null, onDiagnosticGenerated = null, hideResetSection = false }) {
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showFullDetails, setShowFullDetails] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Cross-session pattern (item 1) and growth-vs-history (item 3): both
  // deterministic, both need this student's stats pooled across every
  // session they've ever finished, not just the one being viewed here.
  // realStudentId is the real DB student UUID, only available for a real,
  // signed-in student (the sample report has none, isDemo covers that).
  const [studentStats, setStudentStats] = useState(null);
  useEffect(() => {
    if (!realStudentId || isDemo) return;
    let cancelled = false;
    fetchStudentSessions(realStudentId)
      .then((data) => { if (!cancelled) setStudentStats(data.studentStats || null); })
      .catch(() => { /* silent: this is a bonus callout, not core report functionality */ });
    return () => { cancelled = true; };
  }, [realStudentId, isDemo]);
  const [teacherNotes, setTeacherNotes] = useState("");
  const quotaStatus = useQuotaStatus();

  // Click-to-evidence: a word tapped inside the AI-written report jumps to
  // and briefly highlights that word's own row in the log table below, so
  // a claim can be checked against the raw data instead of just trusted.
  const [highlightedWord, setHighlightedWord] = useState(null);
  const highlightTimeoutRef = useRef(null);
  useEffect(() => () => { if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current); }, []);
  function jumpToWordRow(word) {
    const idx = log.findIndex((e) => e.word.toLowerCase() === word.toLowerCase());
    if (idx === -1) return;
    setHighlightedWord(word.toLowerCase());
    document.getElementById(`word-log-row-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedWord(null), 2500);
  }

  async function handleDownload() {
    SFX.tap();
    setDownloading(true);
    const ok = downloadReport(studentId, log, summary);
    if (!ok) alert("Couldn't download the report. Please try again.");
    setDownloading(false);
  }

  async function generateSummary() {
    setLoading(true);
    setError(null);
    setSummary(null);
    const logForModel = log.map((entry) => {
      const { word, clueType, concreteness, finalStage, hintsUsed, skipped, skipReason, priorKnowledge, gotItVia, clueIdentified, transferPassed, timeToAnswerSec } = entry;
      return {
        word, clueType, concreteness, finalStage, hintsUsed, skipped: !!skipped,
        // Only meaningful when skipped is true: "manual" = gave up right
        // away, "stuck_limit" = kept trying and genuinely couldn't land it —
        // a real difference for a diagnostic report to reason about.
        skipReason: skipped ? skipReason || "manual" : null,
        priorKnowledge: priorKnowledge || null,
        gotItVia: gotItVia || null,
        clueIdentified: clueIdentified || null,
        transferPassed: transferPassed === undefined ? null : transferPassed,
        timeToAnswerSec: timeToAnswerSec || null,
        answeredAtFloor: answeredAtGateFloor(entry),
      };
    });
    const comprehensionForModel = comprehensionResult && comprehensionResult.ran
      ? { correct: comprehensionResult.correct, question: comprehensionResult.question }
      : { correct: null, question: null, note: "No comprehension check ran this session." };
    const userMsg = {
      role: "user",
      content: `Student: ${studentId}\nLog (chronological, oldest first):\n${JSON.stringify(logForModel, null, 2)}\n\nWhole-passage comprehension check:\n${JSON.stringify(comprehensionForModel, null, 2)}${teacherNotes.trim() ? `\n\nTeacher notes about this session's context: ${teacherNotes.trim()}` : ""}`,
    };
    try {
      // Taller max_tokens than every other call: the report writes five
      // fields, three of which need a headline sentence plus bullet
      // points each — more prose than the default 1000-token cap can
      // reliably fit, which was cutting the reply off mid-JSON. The
      // server enforces its own matching cap for this prompt regardless
      // of what's requested here (see DIAGNOSTIC_MAX_TOKENS_CAP in
      // api/_claudeHandler.js).
      const parsed = await callClaudeWithRetry("diagnostic", null, [userMsg], MAX_RETRY_ATTEMPTS, (p) => p && p.corePattern, 1800);
      const nextSummary = {
        summary: parsed.summary || "",
        corePattern: parsed.corePattern,
        howReliable: parsed.howReliable || "",
        storyUnderstandingNote: parsed.storyUnderstandingNote || "",
        whatToTry: parsed.whatToTry || "",
      };
      setSummary(nextSummary);
      onDiagnosticGenerated?.(nextSummary);
      SFX.reportReady();
    } catch (e) {
      setError(`Couldn't generate the summary just now. ${e.message || ""} Try again.`);
    }
    setLoading(false);
  }

  const glance = computeAtAGlance(log);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 step-in relative">
      <FloatingDecor density={4} />
      {/* pl-14/pr-14 clear the fixed close (X) and sound-toggle buttons
          pinned at top-4 left-4 / top-4 right-4, which otherwise overlap
          this row's Back button and "Teacher view" label on every screen
          that reaches TeacherScreen (both a real post-session report and
          the sample report from the main menu). */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2 relative z-10 pl-14 pr-14">
        <button onClick={onBack} className="flex items-center gap-1 font-display font-700 text-xs text-stone-600 hover:text-stone-800 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300">
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>
        <div className="flex items-center gap-2">
          {hideResetSection ? (
            <span className="font-mono text-xs text-stone-500 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300">
              📅 {sessionStartedAt ? new Date(sessionStartedAt).toLocaleDateString() : "Past session"}
            </span>
          ) : (
            <SessionTimer startedAt={sessionStartedAt} className="font-mono text-xs text-stone-500 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300" />
          )}
          <button onClick={() => setShowHelp((s) => !s)} className="font-display font-700 text-xs text-stone-500 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300">
            ℹ️ How this works
          </button>
          <span className="flex items-center gap-1 font-display font-700 text-xs text-stone-500">
            <GraduationCap className="w-3.5 h-3.5" /> Teacher view
          </span>
        </div>
      </div>

      {quotaStatus && quotaStatus.limit != null && (() => {
        const remaining = Math.max(0, quotaStatus.limit - quotaStatus.used);
        const tone = remaining <= 0 ? "text-rose-600" : remaining < SESSION_COST_ESTIMATE ? "text-amber-700" : "text-stone-500";
        return (
          <p className={`font-body text-[11px] mb-4 relative z-10 pl-14 ${tone}`}>
            🔋 {remaining} of {quotaStatus.limit} AI turns left today on this device
            {remaining < SESSION_COST_ESTIMATE && remaining > 0 ? " — getting low, may not cover a full session" : ""}
          </p>
        );
      })()}

      {showHelp && (
        <div className="mb-6 p-4 rounded-2xl bg-sky-50 border-2 border-sky-200 step-in font-body text-sm text-stone-700 leading-relaxed">
          <p className="mb-2"><strong>How to use this:</strong> the student plays through a map during a supervised session, and every word attempt is logged automatically.</p>
          <p className="mb-2">Tap "Generate diagnostic summary" for a full evidence-based report, then "Download results" to save a copy, opens in any browser and can be printed to PDF from there if needed. For a signed-in student, this session also saves to their account automatically, so you can find it again later in the File Box on the main menu, without needing the download.</p>
          <p className="mb-2">The <b>teal Summary</b> box up top is the one thing to read if you're short on time. <b>Blue</b> boxes below it are counted directly from the log, no AI involved.</p>
          <p>Tap "See full details" for the rest: <b>red</b> is the single headline diagnosis, <b>amber</b> boxes are the AI's written evidence and analysis behind it.</p>
        </div>
      )}

      {isDemo && (
        <div className="mb-5 px-4 py-3 rounded-2xl relative z-10 step-in flex items-center gap-2" style={{ background: "#fef3c7", border: "3px solid #d97706" }}>
          <span className="text-xl">🔦</span>
          <p className="font-body text-sm text-amber-900">
            <strong>This is a sample report</strong> with made-up data, showing what a real diagnostic looks like. No student actually played this session.
          </p>
        </div>
      )}

      <h1 className="font-display text-3xl font-800 text-stone-700 mb-1 flex items-center gap-2 relative z-10">📔 Explorer's Field Journal</h1>
      <p className="font-body text-xs text-stone-500 mb-4 relative z-10">Student / Class: {studentId} · {log.length} landmark{log.length === 1 ? "" : "s"} logged this session</p>

      <div className="mb-5 relative z-10">
        <label className="font-display font-700 text-xs uppercase tracking-wide text-stone-500 block mb-1.5">📝 Notes about this session (optional)</label>
        <textarea
          value={teacherNotes}
          onChange={(e) => setTeacherNotes(e.target.value)}
          placeholder="e.g. right after recess, usually stronger with reading, had a rough morning…"
          rows={2}
          className="w-full bg-white rounded-2xl border-[3px] border-stone-300 px-4 py-2.5 font-body text-sm text-stone-700 focus:outline-none focus:border-teal-400"
        />
      </div>

      <div className="text-center mb-6 relative z-10">
        <BigButton onClick={generateSummary} disabled={log.length === 0 || loading}>
          {loading ? "Analysing…" : "🔎 Generate diagnostic summary"}
        </BigButton>
        {error && <p className="font-body text-xs text-rose-600 mt-3" aria-live="polite">{error}</p>}
      </div>

      {loading && <DiagnosticReportSkeleton />}

      {summary && (
        <div className="relative z-10 mb-6 space-y-4 step-in">
          {/* Summary: the one thing a teacher needs in 5 seconds, shown
              biggest and boldest, everything else is opt-in detail below. */}
          <div className="p-7 rounded-3xl text-center bounce-in" style={{ background: "linear-gradient(135deg,#ccfbf1,#99f6e4)", border: "4px solid #0d9488", boxShadow: CARD_SHADOW_HERO }}>
            <p className="font-display font-800 text-xs uppercase tracking-wide text-teal-800 mb-2">📌 Summary</p>
            <p className="font-display font-800 text-xl sm:text-2xl leading-snug text-teal-950">{summary.summary || summary.corePattern || summary.coreProblem}</p>
          </div>

          {/* Legend: always visible (not gated behind "See full details"),
              so what's counted vs. what's AI judgment is clear before a
              teacher even opens the detail sections. */}
          <div className="flex items-center justify-center gap-5 flex-wrap font-display font-800 text-[11px] uppercase tracking-wide text-stone-500">
            <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 h-3.5 rounded" style={{ background: "#dbeafe", border: "2px solid #2563eb" }} /> Counted from log, not AI</span>
            <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 h-3.5 rounded" style={{ background: "#fef3c7", border: "2px solid #d97706" }} /> AI-analyzed</span>
            <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 h-3.5 rounded" style={{ background: "#fee2e2", border: "2px solid #dc2626" }} /> Headline diagnosis</span>
          </div>

          {/* At a Glance / Story Understanding: plain counts, not prose,
              so these stay visible by default even with details collapsed. */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 rounded-3xl" style={{ background: "#dbeafe", border: "3px solid #2563eb" }}>
              <p className="font-display font-800 text-xs uppercase tracking-wide text-blue-800 mb-3">📊 At a Glance</p>
              <div className="space-y-1.5 font-body text-sm text-blue-900">
                <div className="flex justify-between items-center border-b border-blue-200 pb-1"><span>Solved independently</span><b className="font-display text-xl leading-none">{glance.independent}</b></div>
                <div className="flex justify-between items-center border-b border-blue-200 pb-1"><span>Needed hints</span><b className="font-display text-xl leading-none">{glance.withHelp}</b></div>
                <div className="flex justify-between items-center"><span>Skipped</span><b className="font-display text-xl leading-none">{glance.skipped.length}</b></div>
              </div>
              {glance.skipped.length > 0 && (
                <p className="mt-3 text-xs font-body text-rose-700 bg-rose-100 rounded-xl px-3 py-2">
                  ⚠️ Needed direct answers: {glance.skipped.map((e) => `${e.word}${e.skipReason === "stuck_limit" ? " (kept trying)" : ""}`).join(", ")}
                </p>
              )}
              {glance.breakdown.length > 0 && (
                <div className="mt-3 pt-3 border-t border-blue-200 space-y-1">
                  {glance.breakdown.map((b) => (
                    <div key={b.type} className="flex justify-between text-xs font-body text-blue-800 capitalize">
                      <span>{b.type} clues</span><span>{b.independent}/{b.total} independent</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-5 rounded-3xl" style={{ background: "#dbeafe", border: "3px solid #2563eb" }}>
              <p className="font-display font-800 text-xs uppercase tracking-wide text-blue-800 mb-2">📖 Story Understanding</p>
              <p className="font-body text-sm text-blue-900 mb-2">
                Comprehension check: {comprehensionResult && comprehensionResult.ran ? (comprehensionResult.correct ? <b>Correct ✓</b> : <b>Incorrect ✗</b>) : <i>Not run this session</i>}
              </p>
              <BoldText text={summary.storyUnderstandingNote} className="font-body text-sm leading-relaxed text-blue-900" />
            </div>
          </div>

          {studentStats && studentStats.sessionCount >= 2 && (() => {
            const sessionSolved = glance.independent + glance.withHelp;
            const sessionRate = sessionSolved > 0 ? Math.round((glance.independent / sessionSolved) * 100) : null;
            const overallSolved = studentStats.independent + studentStats.withHelp;
            const overallRate = overallSolved > 0 ? Math.round((studentStats.independent / overallSolved) * 100) : null;
            const weakest = weakestClueType(studentStats.breakdown);
            return (
              <div className="p-5 rounded-3xl" style={{ background: "#dbeafe", border: "3px solid #2563eb" }}>
                <p className="font-display font-800 text-xs uppercase tracking-wide text-blue-800 mb-2">📈 Compared To Their Own History</p>
                <p className="font-body text-sm text-blue-900 leading-relaxed">
                  {sessionRate !== null && overallRate !== null && (
                    <>This session: <b>{sessionRate}%</b> solved independently, vs an overall average of <b>{overallRate}%</b> across their {studentStats.sessionCount} tracked sessions. </>
                  )}
                  {weakest && (
                    <><b className="capitalize">{weakest.type}</b>-clue words have needed the most help across their history — {weakest.independent}/{weakest.total} independent.</>
                  )}
                </p>
                <p className="font-body text-[11px] text-blue-600 mt-2">🔢 Counted directly from their logged sessions, not AI</p>
              </div>
            );
          })()}

          <div className="text-center">
            <button
              onClick={() => { SFX.tap(); setShowFullDetails((s) => !s); }}
              className="font-display font-700 text-sm text-teal-700 hover:text-teal-900 bg-white rounded-full px-5 py-2 border-2 border-teal-300 shadow-sm"
            >
              {showFullDetails ? "▲ Hide full details" : "▼ See full details"}
            </button>
          </div>

          {showFullDetails && (
            <div className="space-y-4 step-in">
              {/* 1. The Pattern */}
              <div className="p-6 rounded-3xl text-center" style={{ background: "#fee2e2", border: "4px solid #dc2626" }}>
                <p className="font-display font-800 text-xs uppercase tracking-wide text-red-800 mb-2">🎯 The Pattern</p>
                <RichReportText text={summary.corePattern || summary.coreProblem} className="text-red-900" boldColorClass="text-red-950 font-800" linkWords={log.map((e) => e.word)} onWordClick={jumpToWordRow} />
              </div>

              {/* 2. How Reliable Is This */}
              <div className="p-6 rounded-3xl" style={{ background: "#fef3c7", border: "4px solid #d97706" }}>
                <p className="font-display font-800 text-xs uppercase tracking-wide text-amber-800 mb-2">🧠 How Reliable Is This</p>
                <RichReportText text={summary.howReliable} className="text-amber-900" boldColorClass="text-amber-950 font-800" linkWords={log.map((e) => e.word)} onWordClick={jumpToWordRow} />
              </div>

              {/* 3. What To Try */}
              <div className="p-6 rounded-3xl" style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)", border: "4px solid #d97706" }}>
                <p className="font-display font-800 text-xs uppercase tracking-wide text-amber-800 mb-2">💡 What To Try in Class</p>
                <RichReportText text={summary.whatToTry} className="text-amber-900" boldColorClass="text-amber-950 font-800" linkWords={log.map((e) => e.word)} onWordClick={jumpToWordRow} />
              </div>
            </div>
          )}

          <div className="text-center">
            <BigButton
              variant="outline"
              onClick={handleDownload}
              disabled={log.length === 0 || downloading}
            >
              {downloading ? "Preparing…" : "⬇️ Download results"}
            </BigButton>
          </div>
        </div>
      )}

      {(() => {
        const distinctMaps = [...new Set(log.map((e) => e.passageTitle).filter(Boolean))];
        const showMapColumn = distinctMaps.length > 1;
        return (
          <div className="bg-white rounded-3xl mb-6 overflow-hidden relative z-10" style={{ border: "3px solid #2563eb" }}>
            <table className="w-full text-left">
              <thead className="bg-blue-50 border-b-2 border-blue-200">
                <tr>
                  <th className="font-display font-700 text-[11px] uppercase tracking-wide text-stone-500 px-4 py-3">Word</th>
                  {showMapColumn && <th className="font-display font-700 text-[11px] uppercase tracking-wide text-stone-500 px-4 py-3">Map</th>}
                  <th className="font-display font-700 text-[11px] uppercase tracking-wide text-stone-500 px-4 py-3">Clue Type</th>
                  <th className="font-display font-700 text-[11px] uppercase tracking-wide text-stone-500 px-4 py-3">Stage Reached</th>
                  <th className="font-display font-700 text-[11px] uppercase tracking-wide text-stone-500 px-4 py-3">Hints</th>
                </tr>
              </thead>
              <tbody>
                {log.length === 0 && (
                  <tr><td colSpan={showMapColumn ? 5 : 4} className="px-4 py-8 text-center font-hand text-lg text-stone-500">No words logged yet. Have the student solve a few words first!</td></tr>
                )}
                {log.map((entry, i) => (
                  <tr
                    key={i}
                    id={`word-log-row-${i}`}
                    className={`border-b border-blue-100 last:border-0 transition-colors ${
                      highlightedWord === entry.word.toLowerCase() ? "bg-amber-100" : entry.skipped ? "bg-rose-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-display font-700 text-stone-700">
                      {entry.word}
                      {entry.skipped && <span className="ml-2 font-body font-700 text-[10px] uppercase text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">Skipped</span>}
                    </td>
                    {showMapColumn && <td className="px-4 py-3 font-body text-xs text-stone-600">{entry.passageTitle || "—"}</td>}
                    <td className="px-4 py-3 font-body text-xs text-stone-600 capitalize">{entry.clueType}</td>
                    <td className="px-4 py-3 font-body text-xs text-stone-600">{entry.finalStage} — {STAGE_LABELS[entry.finalStage]}</td>
                    <td className="px-4 py-3 font-body text-xs text-stone-600">{entry.hintsUsed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {!hideResetSection && (
        <div className="mt-10 pt-6 border-t-2 border-stone-200 flex items-center justify-between flex-wrap gap-2 relative z-10">
          <p className="font-body text-[11px] text-stone-500">Clears this session's log. Print or save your results first if you need them.</p>
          <BigButton variant="ghost" onClick={onReset}>
            <RotateCcw className="inline w-3 h-3 mr-1" /> Clear session
          </BigButton>
        </div>
      )}
    </div>
  );
}

/* ---------------- Teacher Guide ---------------- */
// A short, skimmable, on-demand reference for teachers — not a forced
// multi-step tour like the student's TourScreen. Teachers are adults
// reading this once (or looking something up), not kids who benefit
// from game-like guided onboarding, so this is one scrollable page with
// plain sections rather than a paginated flow.
function TeacherGuideScreen({ onBack }) {
  const Section = ({ icon, title, children }) => (
    <div className="bg-white p-5 mb-4 rounded-3xl relative z-10" style={CARD_TEAL}>
      <h2 className="font-display font-800 text-lg text-stone-700 mb-2 flex items-center gap-2">
        <span className="text-2xl">{icon}</span> {title}
      </h2>
      <div className="font-body text-sm text-stone-600 leading-relaxed space-y-2">{children}</div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 step-in relative min-h-screen">
      <FloatingDecor density={4} />
      <button onClick={onBack} className="flex items-center gap-1 font-display font-700 text-xs text-stone-600 hover:text-stone-800 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300 relative z-10 mb-5 ml-14">
        <ChevronLeft className="w-3.5 h-3.5" /> Back to menu
      </button>
      <h1 className="font-display text-2xl font-800 text-stone-700 mb-1 relative z-10">❓ How G.I.S.T. works</h1>
      <p className="font-body text-xs text-stone-500 mb-5 relative z-10">A quick reference, not a tour — read whatever's useful, skip the rest.</p>

      <Section icon="🔑" title="Access codes">
        <p>An access code unlocks the app on a device for your whole school or class — it isn't a per-teacher login. Your school hands out one shared code; anyone who enters it can use G.I.S.T. on that device until the code's session expires (typically a school day).</p>
      </Section>

      <Section icon="🧑‍🎓" title="Student accounts">
        <p>Once the device is unlocked, each student signs up once with their full name and picks 3 secret animals in order — that's their "password" for logging back in next time. It's deliberately simple (kid-friendly, not a real password) and kept separate from the animal companion shown on screen during play, so a classmate watching them play can't read it off the screen.</p>
        <p>A returning student re-enters both to pick up where they left off, with their same coach and look already set.</p>
      </Section>

      <Section icon="🗺️" title="Playing a session">
        <p>A student picks a passage, then works through its target vocabulary words one at a time with an AI coach, always guided to work out the meaning from context, never just told the answer. A short comprehension check on the whole passage runs at the end.</p>
      </Section>

      <Section icon="🛠️" title="The custom map maker">
        <p>Paste in any passage (80-150 words works best) and G.I.S.T. picks target words for you, ready in under a minute. The number of target words is fixed, deliberately, to keep each map's AI cost predictable — but you're not stuck with whatever the AI picks: the "Words to highlight" boxes let you require specific words yourself, and the AI fills any boxes you leave blank.</p>
      </Section>

      <Section icon="📔" title="The diagnostic report">
        <p>Every word attempt during a session is logged automatically (which word, how many hints it took, whether it was skipped, and more). That log is what actually gets analyzed — nothing about the report is guessed or generic.</p>
        <p>The report opens with a one-line <b>teal Summary</b> and the <b>blue</b> count boxes, counted directly from the log, no AI involved. Tap "See full details" for the rest: the <b>red</b> headline diagnosis and the <b>amber</b> boxes, the AI's written analysis behind it.</p>
      </Section>

      <Section icon="🗃️" title="The File Box">
        <p>Every student who's signed up under your access code shows up here, with their full session history — reachable any time from the main menu, not just right after a student finishes playing. Open a student to see their past sessions, and open a session to see its full report again.</p>
        <p>Two small icons sit next to each student: <b>🔑 Reset secret</b> lets you set new secret animals with a student right there if they've forgotten theirs, no need to know the old ones. <b>🗑️ Delete</b> permanently removes that student and every one of their sessions — useful for clearing out a test account or a duplicate signup. The same 🗑️ delete also appears next to each individual session, for removing just one session without touching the rest of a student's history. Both deletes ask you to confirm first, and neither can be undone once confirmed, so use them deliberately.</p>
      </Section>
    </div>
  );
}

// A non-technical teacher's path to their own adapted copy of G.I.S.T.,
// split into two views on purpose: "blueprint" solves the comprehension
// barrier (handing an AI assistant the real design so it can adapt it
// faithfully), "next-steps" solves the separate deployment barrier (the
// actual accounts needed to put it online) — see the plan behind this
// feature for why those two are kept apart rather than one long page.
function BuildYourOwnScreen({ onBack }) {
  const [view, setView] = useState("blueprint"); // "blueprint" | "next-steps"
  const [copied, setCopied] = useState(false);

  const Section = ({ icon, title, children }) => (
    <div className="bg-white p-5 mb-4 rounded-3xl relative z-10" style={CARD_TEAL}>
      <h2 className="font-display font-800 text-lg text-stone-700 mb-2 flex items-center gap-2">
        <span className="text-2xl">{icon}</span> {title}
      </h2>
      <div className="font-body text-sm text-stone-600 leading-relaxed space-y-2">{children}</div>
    </div>
  );

  function handleBack() {
    SFX.tap();
    if (view === "next-steps") { setView("blueprint"); return; }
    onBack();
  }

  async function handleCopy() {
    SFX.click();
    try {
      await navigator.clipboard.writeText(BUILD_YOUR_OWN_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // Clipboard API can be unavailable (insecure context, permissions,
      // older browser) — the prompt is still selectable by hand from the
      // box below, so this just silently skips the one-click convenience.
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 step-in relative min-h-screen">
      <FloatingDecor density={4} />
      <button onClick={handleBack} className="flex items-center gap-1 font-display font-700 text-xs text-stone-600 hover:text-stone-800 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300 relative z-10 mb-5 ml-14">
        <ChevronLeft className="w-3.5 h-3.5" /> {view === "next-steps" ? "Back" : "Back to menu"}
      </button>

      {view === "blueprint" ? (
        <>
          <h1 className="font-display text-2xl font-800 text-stone-700 mb-1 relative z-10">🧭 Build Your Own G.I.S.T.</h1>
          <p className="font-body text-xs text-stone-500 mb-5 relative z-10">
            Hand this to an AI assistant (Claude, ChatGPT, or similar) and ask it to adapt G.I.S.T. for your own class — a different age group, a different language emphasis, even a different subject entirely.
          </p>

          <Section icon="📋" title="The blueprint">
            <p>This is G.I.S.T.'s real design, the same prompts the app actually sends, not a summary of them. Copy it, paste it into your AI assistant of choice, and ask it to <b>adapt</b> G.I.S.T. rather than start from a blank page — it already has some hard-won lessons baked in (a grading-accuracy fix, a plain-language report rewrite, both found by testing with real students and a real teacher) that a fresh rebuild would have to relearn the hard way.</p>
            <button
              onClick={handleCopy}
              className="font-display font-700 text-sm text-teal-700 hover:text-teal-900 bg-white rounded-full px-4 py-2 border-2 mt-1"
              style={{ borderColor: "#0d9488" }}
              aria-live="polite"
            >
              {copied ? "✅ Copied!" : "📋 Copy prompt"}
            </button>
            <div
              className="mt-3 p-4 rounded-2xl bg-stone-50 font-body text-xs text-stone-600 leading-relaxed whitespace-pre-wrap overflow-y-auto"
              style={{ border: "2px solid #d6d3d1", maxHeight: "320px" }}
            >
              {BUILD_YOUR_OWN_PROMPT}
            </div>
          </Section>

          <button
            onClick={() => { SFX.tap(); setView("next-steps"); }}
            className="w-full text-center font-display font-700 text-sm text-violet-700 hover:text-violet-900 bg-white rounded-full px-4 py-3 border-2 relative z-10"
            style={{ borderColor: "#7c3aed" }}
          >
            Ready to actually put this online? Next: getting it live →
          </button>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl font-800 text-stone-700 mb-1 relative z-10">🚀 Getting it live</h1>
          <p className="font-body text-xs text-stone-500 mb-5 relative z-10">
            The blueprint gets your AI assistant to write the code. To actually put it online, you'll need three free accounts ready to hand over when it asks for them.
          </p>

          <Section icon="🧠" title="Somewhere to run the AI">
            <p>This is what lets the app talk to an AI. Groq gives out a free API key for this — free, no credit card needed.</p>
            <p><a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="text-teal-700 underline font-700">console.groq.com<span className="sr-only"> (opens in a new tab)</span></a></p>
          </Section>

          <Section icon="🗄️" title="Somewhere to save student progress">
            <p>This is where student accounts and their session history actually live. Supabase gives out a free database for this — free, no credit card needed.</p>
            <p><a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-teal-700 underline font-700">supabase.com<span className="sr-only"> (opens in a new tab)</span></a></p>
          </Section>

          <Section icon="🌐" title="Somewhere to host the website">
            <p>This puts the finished website online with a real link you can share with your school. Vercel hosts it for free — free, no credit card needed.</p>
            <p><a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="text-teal-700 underline font-700">vercel.com<span className="sr-only"> (opens in a new tab)</span></a></p>
          </Section>

          <Section icon="🔒" title="Keep this part safe">
            <p>Each of these three gives you a secret key. Treat every one of them exactly like a password: never paste it into a public chat, a screenshot, or a shared document. Setting one shared access code for your own school or class, rather than leaving the tool fully open to anyone, is what keeps it locked to your own students once it's live.</p>
          </Section>

          <div className="mt-2 p-4 rounded-2xl text-center relative z-10" style={{ border: "2px solid #7c3aed", background: "#f5f3ff" }}>
            <p className="font-body text-sm text-stone-600">Once you have these three ready, go back to the AI assistant you pasted the blueprint into and hand them over — it can take it from there.</p>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Teacher File Box ---------------- */
// The teacher-facing view of persisted student progress: every student
// who has signed up under this device's access code, and their past
// sessions. Three internal views (roster -> a student's sessions -> one
// session's full report) rather than separate screen types, since all
// three share the same back-and-forth navigation and none of them are
// ever reachable except through this one entry point.
function FileBoxScreen({ onBack }) {
  const [view, setView] = useState("roster"); // "roster" | "sessions" | "detail"
  const [roster, setRoster] = useState(null);
  const [classStats, setClassStats] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [resetTarget, setResetTarget] = useState(null); // roster entry currently being secret-reset, or null
  const [resetSuccessName, setResetSuccessName] = useState(null);
  const [deleteStudentTarget, setDeleteStudentTarget] = useState(null); // roster entry pending delete confirmation, or null
  const [deleteSessionTarget, setDeleteSessionTarget] = useState(null); // session pending delete confirmation, or null

  // Class grouping: not every student has to be in a class (see
  // schema.sql's students.class_id), so the roster can be scoped to
  // "All" (null), one real class (its id), or "Unassigned" ("none", the
  // server's sentinel -- see _teacherRosterHandler.js). classStats comes
  // back from the server already computed for whichever scope is active,
  // so the "At a Glance" rollup stays accurate to what's actually shown.
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [rosterRefreshKey, setRosterRefreshKey] = useState(0);
  const [showAddClass, setShowAddClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [classActionError, setClassActionError] = useState(null);
  const [classActionBusy, setClassActionBusy] = useState(false);
  const [renamingClassId, setRenamingClassId] = useState(null);
  const [renameClassName, setRenameClassName] = useState("");
  const [deleteClassTarget, setDeleteClassTarget] = useState(null); // {id, name} pending delete confirmation, or null

  const rosterRequestRef = useRef(0);
  useEffect(() => {
    setRosterLoading(true);
    setRosterError(null);
    const requestId = ++rosterRequestRef.current;
    fetchTeacherRoster(selectedClassId)
      .then((data) => {
        if (requestId !== rosterRequestRef.current) return;
        setRoster(data.students);
        setClassStats(data.classStats || null);
        setClasses(data.classes || []);
      })
      .catch((e) => { if (requestId === rosterRequestRef.current) setRosterError(e.message || "Couldn't load the roster"); })
      .finally(() => { if (requestId === rosterRequestRef.current) setRosterLoading(false); });
  }, [selectedClassId, rosterRefreshKey]);

  async function handleCreateClass() {
    const name = newClassName.trim();
    if (!name || classActionBusy) return;
    setClassActionBusy(true);
    setClassActionError(null);
    try {
      await createClass(name);
      setNewClassName("");
      setShowAddClass(false);
      setRosterRefreshKey((k) => k + 1);
    } catch (e) {
      setClassActionError(e.message || "Couldn't create the class");
    } finally {
      setClassActionBusy(false);
    }
  }

  async function handleRenameClass(classId) {
    const name = renameClassName.trim();
    if (!name || classActionBusy) return;
    setClassActionBusy(true);
    setClassActionError(null);
    try {
      await renameClass(classId, name);
      setRenamingClassId(null);
      setRosterRefreshKey((k) => k + 1);
    } catch (e) {
      setClassActionError(e.message || "Couldn't rename the class");
    } finally {
      setClassActionBusy(false);
    }
  }

  async function handleAssignStudent(studentId, classId) {
    setClassActionError(null);
    try {
      await assignStudentToClass(studentId, classId || null);
      setRosterRefreshKey((k) => k + 1);
    } catch (e) {
      setClassActionError(e.message || "Couldn't move this student");
    }
  }

  // Both fetches below are keyed by an incrementing request id rather than
  // a simple "cancelled" flag: a teacher can tap one student/session, then
  // quickly tap another before the first request resolves. Without this,
  // whichever response lands LAST wins even if it was requested first,
  // showing one student's name next to another's session data.
  const sessionsRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  function openStudent(student) {
    SFX.tap();
    setSelectedStudent(student);
    setSessions(null);
    setSessionsError(null);
    setSessionsLoading(true);
    setView("sessions");
    const requestId = ++sessionsRequestRef.current;
    fetchStudentSessions(student.id)
      .then((data) => { if (requestId === sessionsRequestRef.current) setSessions(data.sessions); })
      .catch((e) => { if (requestId === sessionsRequestRef.current) setSessionsError(e.message || "Couldn't load this student's sessions"); })
      .finally(() => { if (requestId === sessionsRequestRef.current) setSessionsLoading(false); });
  }

  function openSession(session) {
    SFX.tap();
    setSelectedSession(session);
    setSessionDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setView("detail");
    const requestId = ++detailRequestRef.current;
    fetchSessionDetail(session.id)
      .then((data) => { if (requestId === detailRequestRef.current) setSessionDetail(data); })
      .catch((e) => { if (requestId === detailRequestRef.current) setDetailError(e.message || "Couldn't load this session"); })
      .finally(() => { if (requestId === detailRequestRef.current) setDetailLoading(false); });
  }

  if (view === "detail") {
    if (!detailLoading && sessionDetail) {
      return (
        <TeacherScreen
          studentId={sessionDetail.session.studentName}
          realStudentId={sessionDetail.session.studentId}
          log={sessionDetail.log}
          comprehensionResult={sessionDetail.session.comprehensionResult}
          sessionStartedAt={new Date(sessionDetail.session.startedAt).getTime()}
          initialSummary={sessionDetail.session.diagnosticReport}
          onDiagnosticGenerated={(summary) => cacheSessionDiagnostic(sessionDetail.session.id, summary).catch(() => {})}
          onBack={() => setView("sessions")}
          onReset={() => setView("sessions")}
          hideResetSection
        />
      );
    }
    return (
      <div className="max-w-2xl mx-auto px-6 py-8 step-in min-h-screen flex flex-col justify-center relative">
        <FloatingDecor density={4} />
        <div className="bg-white p-8 step-in relative z-10 text-center" style={CARD_TEAL}>
          {detailLoading ? (
            <p className="font-hand text-xl text-stone-500">Loading this session…</p>
          ) : (
            <>
              <p className="font-body text-sm text-rose-600 mb-4">{detailError || "Couldn't load this session"}</p>
              <BigButton variant="ghost" onClick={() => setView("sessions")}>
                <ChevronLeft className="inline w-4 h-4 mr-1" /> Back
              </BigButton>
            </>
          )}
        </div>
      </div>
    );
  }

  if (view === "sessions") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8 step-in relative min-h-screen">
        <FloatingDecor density={4} />
        <button onClick={() => setView("roster")} className="flex items-center gap-1 font-display font-700 text-xs text-stone-600 hover:text-stone-800 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300 relative z-10 mb-5 ml-14">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to roster
        </button>
        <h1 className="font-display text-2xl font-800 text-stone-700 mb-1 relative z-10">🗃️ {selectedStudent?.fullName}'s sessions</h1>
        <p className="font-body text-xs text-stone-500 mb-5 relative z-10">Tap a session to see its full diagnostic report.</p>

        {sessionsLoading && <p className="font-hand text-lg text-stone-500 relative z-10">Loading…</p>}
        {sessionsError && <p className="font-body text-sm text-rose-600 relative z-10">{sessionsError}</p>}
        {sessions && sessions.length === 0 && (
          <p className="font-body text-sm text-stone-500 relative z-10">No completed sessions yet for this student.</p>
        )}
        <div className="flex flex-col gap-2.5 relative z-10">
          {sessions?.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <button
                onClick={() => openSession(s)}
                className="flex-1 flex items-center gap-3 text-left px-4 py-3.5 bg-white rounded-2xl hover:scale-[1.01] transition-all"
                style={{ border: "3px solid #d6d3d1" }}
              >
                <span className="text-2xl shrink-0">{s.passageEmoji || "📖"}</span>
                <div className="flex-1">
                  <p className="font-display font-800 text-sm text-stone-700">{s.passageTitle}</p>
                  <p className="font-body text-xs text-stone-500">
                    {new Date(s.finishedAt).toLocaleDateString()} · {s.wordCount} word{s.wordCount === 1 ? "" : "s"}
                    {s.comprehensionCorrect !== null ? ` · comprehension ${s.comprehensionCorrect ? "✓" : "✗"}` : ""}
                  </p>
                </div>
              </button>
              <button
                onClick={() => { SFX.tap(); setDeleteSessionTarget(s); }}
                className="shrink-0 w-11 h-11 rounded-full bg-white flex items-center justify-center text-base"
                style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
                title={`Delete this ${s.passageTitle} session`}
                aria-label={`Delete this ${s.passageTitle} session`}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>

        {deleteSessionTarget && (
          <ConfirmDeleteModal
            heading="Delete this session?"
            message={`This permanently deletes the "${deleteSessionTarget.passageTitle}" session from ${new Date(deleteSessionTarget.finishedAt).toLocaleDateString()} and its full word log.`}
            onCancel={() => setDeleteSessionTarget(null)}
            onConfirm={async () => {
              await deleteSession(deleteSessionTarget.id);
              const remaining = sessions.filter((sess) => sess.id !== deleteSessionTarget.id);
              setSessions(remaining);
              // Keep the roster screen's cached sessionCount/lastSessionAt
              // in sync too, so navigating "Back to roster" right after a
              // delete doesn't show stale counts until the whole File Box
              // is reopened and fetchTeacherRoster() reruns.
              const newLastSessionAt = remaining.reduce(
                (latest, sess) => (!latest || sess.finishedAt > latest ? sess.finishedAt : latest),
                null
              );
              setRoster((prev) =>
                prev?.map((r) =>
                  r.id === selectedStudent.id ? { ...r, sessionCount: remaining.length, lastSessionAt: newLastSessionAt } : r
                ) ?? prev
              );
              setDeleteSessionTarget(null);
            }}
          />
        )}
      </div>
    );
  }

  // view === "roster"
  return (
    <div className="max-w-2xl mx-auto px-6 py-8 step-in relative min-h-screen">
      <FloatingDecor density={5} />
      <button onClick={onBack} className="flex items-center gap-1 font-display font-700 text-xs text-stone-600 hover:text-stone-800 bg-white rounded-full px-3 py-1.5 border-[3px] border-stone-300 relative z-10 mb-5 ml-14">
        <ChevronLeft className="w-3.5 h-3.5" /> Back to menu
      </button>
      <h1 className="font-display text-2xl font-800 text-stone-700 mb-1 relative z-10">🗃️ File Box</h1>
      <p className="font-body text-xs text-stone-500 mb-5 relative z-10">Every student who's signed up under this access code, and their past progress.</p>

      {/* Class scope: not every student has to be in a class -- pick "All
          students" (the whole access-code roster), one real class, or
          "Unassigned". The roster list and the At a Glance rollup below
          both come straight from the server already scoped to this. */}
      <div className="flex flex-wrap items-center gap-2 mb-3 relative z-10">
        <button
          onClick={() => { SFX.tap(); setSelectedClassId(null); }}
          className="font-display font-700 text-xs rounded-full px-3 py-1.5 border-2 transition-all"
          style={selectedClassId === null ? { background: "#0d9488", color: "white", borderColor: "#0d9488" } : { background: "white", color: "#57534e", borderColor: "#d6d3d1" }}
        >
          All students
        </button>
        {classes.map((c) => (
          <button
            key={c.id}
            onClick={() => { SFX.tap(); setSelectedClassId(c.id); }}
            className="font-display font-700 text-xs rounded-full px-3 py-1.5 border-2 transition-all"
            style={selectedClassId === c.id ? { background: "#0d9488", color: "white", borderColor: "#0d9488" } : { background: "white", color: "#57534e", borderColor: "#d6d3d1" }}
          >
            {c.name}
          </button>
        ))}
        <button
          onClick={() => { SFX.tap(); setSelectedClassId("none"); }}
          className="font-display font-700 text-xs rounded-full px-3 py-1.5 border-2 transition-all"
          style={selectedClassId === "none" ? { background: "#0d9488", color: "white", borderColor: "#0d9488" } : { background: "white", color: "#57534e", borderColor: "#d6d3d1" }}
        >
          Unassigned
        </button>
        {!showAddClass && (
          <button
            onClick={() => { SFX.tap(); setShowAddClass(true); setClassActionError(null); }}
            className="font-display font-700 text-xs text-teal-700 rounded-full px-3 py-1.5 border-2 border-dashed"
            style={{ borderColor: "#0d9488" }}
          >
            + New class
          </button>
        )}
      </div>

      {showAddClass && (
        <div className="flex items-center gap-2 mb-3 relative z-10">
          <input
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreateClass(); }}
            placeholder="Class name, e.g. 4A"
            aria-label="New class name"
            autoFocus
            maxLength={60}
            className="flex-1 bg-white rounded-full border-2 border-stone-300 px-4 py-2 font-body text-sm text-stone-700 focus:outline-none focus:border-teal-400"
          />
          <button
            onClick={handleCreateClass}
            disabled={!newClassName.trim() || classActionBusy}
            className="font-display font-700 text-xs text-white bg-teal-600 rounded-full px-4 py-2 disabled:opacity-40"
          >
            Add
          </button>
          <button onClick={() => { setShowAddClass(false); setNewClassName(""); }} className="font-body text-xs text-stone-500">
            Cancel
          </button>
        </div>
      )}

      {selectedClassId && selectedClassId !== "none" && (() => {
        const current = classes.find((c) => c.id === selectedClassId);
        if (!current) return null;
        return renamingClassId === current.id ? (
          <div className="flex items-center gap-2 mb-3 relative z-10">
            <input
              value={renameClassName}
              onChange={(e) => setRenameClassName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRenameClass(current.id); }}
              aria-label="Rename class"
              autoFocus
              maxLength={60}
              className="flex-1 bg-white rounded-full border-2 border-stone-300 px-4 py-2 font-body text-sm text-stone-700 focus:outline-none focus:border-teal-400"
            />
            <button
              onClick={() => handleRenameClass(current.id)}
              disabled={!renameClassName.trim() || classActionBusy}
              className="font-display font-700 text-xs text-white bg-teal-600 rounded-full px-4 py-2 disabled:opacity-40"
            >
              Save
            </button>
            <button onClick={() => setRenamingClassId(null)} className="font-body text-xs text-stone-500">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-3 mb-3 relative z-10">
            <button
              onClick={() => { SFX.tap(); setRenamingClassId(current.id); setRenameClassName(current.name); }}
              className="font-body text-xs text-stone-500 underline"
            >
              ✏️ Rename "{current.name}"
            </button>
            <button onClick={() => { SFX.tap(); setDeleteClassTarget(current); }} className="font-body text-xs text-rose-600 underline">
              🗑️ Delete class
            </button>
          </div>
        );
      })()}

      {classActionError && <p className="font-body text-xs text-rose-600 mb-3 relative z-10">{classActionError}</p>}

      {rosterLoading && <p className="font-hand text-lg text-stone-500 relative z-10">Loading…</p>}
      {rosterError && <p className="font-body text-sm text-rose-600 relative z-10">{rosterError}</p>}
      {roster && roster.length === 0 && (
        <p className="font-body text-sm text-stone-500 relative z-10">
          {selectedClassId === "none"
            ? "No unassigned students right now — everyone's in a class."
            : selectedClassId
            ? "No students in this class yet. Move some in from another view, or wait for new sign-ups."
            : "No students yet. They'll show up here once someone signs up as a new student."}
        </p>
      )}

      {classStats && classStats.total >= 3 && (() => {
        const rate = Math.round((classStats.independent / classStats.total) * 100);
        const weakest = weakestClueType(classStats.breakdown);
        const scopeLabel = selectedClassId === "none"
          ? "Unassigned Students"
          : selectedClassId
          ? classes.find((c) => c.id === selectedClassId)?.name || "This Class"
          : "Whole Roster";
        return (
          <div className="mb-4 p-5 rounded-3xl relative z-10 step-in" style={{ background: "#dbeafe", border: "3px solid #2563eb" }}>
            <p className="font-display font-800 text-xs uppercase tracking-wide text-blue-800 mb-2">📊 {scopeLabel}, At a Glance</p>
            <p className="font-body text-sm text-blue-900 leading-relaxed">
              Across <b>{classStats.studentCount}</b> student{classStats.studentCount === 1 ? "" : "s"} and <b>{classStats.total}</b> word{classStats.total === 1 ? "" : "s"} attempted, <b>{rate}%</b> were solved independently.
              {weakest && (
                <> <b className="capitalize">{weakest.type}</b>-clue words have been the toughest so far — {weakest.independent}/{weakest.total} independent, worth a quick class review.</>
              )}
            </p>
            <p className="font-body text-[11px] text-blue-600 mt-2">🔢 Counted directly from every logged word, not AI</p>
          </div>
        );
      })()}
      {resetSuccessName && (
        <div
          className="flex items-center justify-between gap-2 mb-3 px-4 py-2.5 rounded-2xl bg-emerald-50 relative z-10"
          style={{ border: "2px solid #34d399" }}
          aria-live="polite"
        >
          <p className="font-body text-xs text-emerald-700">✅ New secret set for {resetSuccessName}. They can log in with it now.</p>
          <button
            onClick={() => setResetSuccessName(null)}
            className="font-body text-xs text-emerald-700 underline shrink-0"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="flex flex-col gap-2.5 relative z-10">
        {roster?.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <button
              onClick={() => openStudent(s)}
              className="flex-1 flex items-center justify-between text-left px-4 py-3.5 bg-white rounded-2xl hover:scale-[1.01] transition-all"
              style={{ border: "3px solid #d6d3d1" }}
            >
              <p className="font-display font-800 text-sm text-stone-700">{s.fullName}</p>
              <p className="font-body text-xs text-stone-500">
                {s.sessionCount} session{s.sessionCount === 1 ? "" : "s"}
                {s.lastSessionAt ? ` · last played ${new Date(s.lastSessionAt).toLocaleDateString()}` : ""}
              </p>
            </button>
            <select
              value={s.classId || ""}
              onChange={(e) => handleAssignStudent(s.id, e.target.value)}
              aria-label={`Move ${s.fullName} to a class`}
              title={`Move ${s.fullName} to a class`}
              className="shrink-0 font-body text-xs text-stone-600 bg-white rounded-full px-2.5 py-2.5 border-2 border-stone-300 focus:outline-none max-w-[110px]"
            >
              <option value="">Unassigned</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={() => { SFX.tap(); setResetSuccessName(null); setResetTarget(s); }}
              className="shrink-0 w-11 h-11 rounded-full bg-white flex items-center justify-center text-base"
              style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
              title={`Reset ${s.fullName}'s secret`}
              aria-label={`Reset ${s.fullName}'s secret`}
            >
              🔑
            </button>
            <button
              onClick={() => { SFX.tap(); setResetSuccessName(null); setDeleteStudentTarget(s); }}
              className="shrink-0 w-11 h-11 rounded-full bg-white flex items-center justify-center text-base"
              style={{ border: "2px solid #e7e5e4", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
              title={`Delete ${s.fullName}'s account`}
              aria-label={`Delete ${s.fullName}'s account`}
            >
              🗑️
            </button>
          </div>
        ))}
      </div>

      {resetTarget && (
        <ResetSecretModal
          student={resetTarget}
          onCancel={() => setResetTarget(null)}
          onReset={() => { setResetSuccessName(resetTarget.fullName); setResetTarget(null); }}
        />
      )}

      {deleteStudentTarget && (
        <ConfirmDeleteModal
          heading={`Delete ${deleteStudentTarget.fullName}'s account?`}
          message={`This permanently deletes ${deleteStudentTarget.fullName} and every one of their ${deleteStudentTarget.sessionCount} session${deleteStudentTarget.sessionCount === 1 ? "" : "s"}.`}
          onCancel={() => setDeleteStudentTarget(null)}
          onConfirm={async () => {
            await deleteStudentAccount(deleteStudentTarget.id);
            setRoster((prev) => prev.filter((r) => r.id !== deleteStudentTarget.id));
            setDeleteStudentTarget(null);
            // The instant filter above keeps the list itself snappy, but
            // classStats (studentCount/totals) needs a real refetch to
            // stay accurate now that this student's words are gone.
            setRosterRefreshKey((k) => k + 1);
          }}
        />
      )}

      {deleteClassTarget && (
        <ConfirmDeleteModal
          heading={`Delete "${deleteClassTarget.name}"?`}
          message={`This deletes the class itself, not its students — they move back to "Unassigned", nothing about their accounts or progress changes.`}
          onCancel={() => setDeleteClassTarget(null)}
          onConfirm={async () => {
            await deleteClass(deleteClassTarget.id);
            if (selectedClassId === deleteClassTarget.id) setSelectedClassId(null);
            setDeleteClassTarget(null);
            setRosterRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Access Gate Screen ---------------- */
function AccessGateScreen({ onUnlocked }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!code.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error || "Couldn't verify that code, please try again.");
        return;
      }
      if (data.dailyLimit) saveQuotaCache({ limit: data.dailyLimit });
      onUnlocked(data.token, data.expiresAt);
    } catch (e) {
      setError("Couldn't reach the server, check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-6 py-8 step-in min-h-screen flex flex-col justify-center relative">
      <FloatingDecor density={5} />
      <div className="text-center mb-4 relative z-10">
        <div className="flex justify-center mb-1"><CompassRose size={84} tone="teal" /></div>
        <h1 className="font-display text-6xl font-800 sticker-title-teal mb-1">G.I.S.T.</h1>
      </div>
      <div className="relative z-10 bg-white p-8" style={CARD_TEAL}>
        <p className="font-display font-800 text-sm uppercase tracking-wide text-stone-600 mb-2 text-center">Access Code</p>
        <p className="font-body text-sm text-stone-700 leading-relaxed mb-5 text-center">
          Ask your teacher or school for the code to unlock G.I.S.T.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter access code"
          aria-label="Access code"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="w-full bg-teal-50 rounded-2xl border-2 border-teal-300 px-4 py-4 font-body text-xl text-stone-700 text-center focus:outline-none focus:border-teal-500 placeholder:text-stone-500"
        />
        {error && <p className="font-body text-xs text-red-600 text-center mt-3" aria-live="polite">{error}</p>}
        <div className="flex justify-center mt-6">
          <BigButton onClick={handleSubmit} disabled={!code.trim() || loading}>
            {loading ? "Checking…" : "Unlock"}
          </BigButton>
        </div>
      </div>
    </div>
  );
}

/* ---------------- App ---------------- */
export default function App() {
  const [screen, setScreen] = useState("setup");
  const [studentId, setStudentId] = useState("");
  const [avatarConfig, setAvatarConfig] = useState(DEFAULT_AVATAR_CONFIG);
  const [passageId, setPassageId] = useState("orangutan");
  const [customPassages, setCustomPassages] = useState([]);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [transferWordId, setTransferWordId] = useState(null);
  const [activeWordCount, setActiveWordCount] = useState(null);
  const [comprehensionResult, setComprehensionResult] = useState(null);
  const [log, setLog] = useState([]);
  const [solvedWords, setSolvedWords] = useState([]);
  const [activeWord, setActiveWord] = useState(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [streakMsg, setStreakMsg] = useState(null);
  const [soundOn, setSoundOn] = useState(true);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [appClosed, setAppClosed] = useState(false);
  const [bilingual, setBilingual] = useState(false);
  const [revealedCount, setRevealedCount] = useState(1);
  const [authInfo, setAuthInfo] = useState(() => loadCachedAuth());
  const [studentAuth, setStudentAuth] = useState(() => loadCachedStudentAuth());
  // Tracks whether we've ever been authenticated this page-load (survives
  // authInfo going back to null), so a mid-session token expiry — e.g.
  // while a word is mid-conversation in CoachScreen — can be told apart
  // from the very first, pre-auth load. On expiry the first case would
  // otherwise unmount the entire main tree (CoachScreen included) to swap
  // in AccessGateScreen, destroying that word's in-progress history/hints
  // for no reason beyond needing the code re-entered. See the render logic
  // below: once this is true, a null authInfo shows a re-auth overlay on
  // top of the still-mounted main tree instead of replacing it.
  const hasAuthenticatedOnceRef = useRef(!!authInfo);

  useEffect(() => {
    currentAuthToken = authInfo?.token || null;
    if (authInfo) hasAuthenticatedOnceRef.current = true;
  }, [authInfo]);

  useEffect(() => {
    currentStudentToken = studentAuth?.token || null;
  }, [studentAuth]);

  useEffect(() => {
    onAuthInvalidated = () => { clearCachedAuth(); setAuthInfo(null); };
    return () => { onAuthInvalidated = null; };
  }, []);

  useEffect(() => {
    const unlock = () => { unlockSpeechOnce(); if (soundEnabled) startBackgroundMusic(); document.removeEventListener("pointerdown", unlock); };
    document.addEventListener("pointerdown", unlock);
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);

  const isFirstScreenRef = useRef(true);
  useEffect(() => {
    if (isFirstScreenRef.current) { isFirstScreenRef.current = false; return; }
    SFX.pageTurn();
  }, [screen]);

  const fullPassage = PASSAGES[passageId] || customPassages.find((p) => p.id === passageId);
  const passage = fullPassage
    ? { ...fullPassage, words: fullPassage.words.slice(0, activeWordCount || fullPassage.words.length) }
    : null;

  function handleSaveCustomPassage(id, passageData) {
    setCustomPassages((prev) => [...prev, { id, ...passageData }]);
  }

  function handleBegin(name, config, pId, wordCount) {
    setStudentId(name);
    setAvatarConfig(config);
    setPassageId(pId);
    setLog([]);
    setSolvedWords([]);
    setSessionStartedAt(Date.now());
    setRevealedCount(1);
    const chosenPassage = PASSAGES[pId] || customPassages.find((p) => p.id === pId);
    const count = chosenPassage && chosenPassage.words ? Math.min(wordCount || chosenPassage.words.length, chosenPassage.words.length) : null;
    setActiveWordCount(count);
    const sessionWords = chosenPassage && chosenPassage.words ? chosenPassage.words.slice(0, count || chosenPassage.words.length) : [];
    if (sessionWords.length) {
      const pick = sessionWords[Math.floor(Math.random() * sessionWords.length)];
      setTransferWordId(pick.word);
    } else {
      setTransferWordId(null);
    }
    setScreen("passage");
  }

  function handleWordResolved(entry) {
    const newLog = [...log, entry];
    setLog(newLog);
    setSolvedWords((s) => [...s, entry.word]);
    const total = newLog.length;
    const nowSolvedInPassage = [...solvedWords, entry.word];
    const passageComplete = passage.words.every((w) => nowSolvedInPassage.includes(w.word));
    if (passageComplete) {
      setTimeout(() => SFX.trophy(), 400);
    } else if ([5, 10, 20].includes(total)) {
      setTimeout(() => SFX.milestone(), 300);
    }
    setStreakMsg(
      entry.skipped
        ? `👍 No worries, "${entry.word}" is marked for your teacher to help with. On to the next one!`
        : `🎉 Word #${total} solved! You reached Stage ${entry.finalStage}: ${STAGE_LABELS[entry.finalStage]}.`
    );
    setActiveWord(null);
    if (passageComplete) {
      setScreen("comprehension");
    } else {
      setScreen("passage");
    }
    setTimeout(() => setStreakMsg(null), 6000);
  }

  function handleReset() {
    setLog([]);
    setSolvedWords([]);
  }

  // Hands the device off to the next student: clears this student's
  // identity and in-progress session state and returns to the main menu,
  // without needing to close and reopen the whole app (which would also
  // discard the teacher's access-code session).
  function handleSwitchStudent() {
    clearCachedStudentAuth();
    currentStudentToken = null;
    setStudentAuth(null);
    setLog([]);
    setSolvedWords([]);
    setStudentId("");
    setAvatarConfig(DEFAULT_AVATAR_CONFIG);
    setComprehensionResult(null);
    setScreen("setup");
  }

  if (!authInfo && !hasAuthenticatedOnceRef.current) {
    return (
      <div className="min-h-screen text-stone-700" style={{ fontFamily: "ui-sans-serif, system-ui", background: "#FAF6EF" }}>
        <FontImport />
        <OuterFrame tone="teal" />
        <AmbientIcons palette="teal" />
        <main>
          <AccessGateScreen
            onUnlocked={(token, expiresAt) => {
              saveCachedAuth(token, expiresAt);
              setAuthInfo({ token, expiresAt });
            }}
          />
        </main>
      </div>
    );
  }

  if (appClosed) {
    return (
      <div className="min-h-screen text-stone-700" style={{ fontFamily: "ui-sans-serif, system-ui", background: "#FAF6EF" }}>
        <FontImport />
        <OuterFrame tone="gold" />
        <AmbientIcons palette="gold" />
        <main>
          <ClosedScreen />
        </main>
      </div>
    );
  }

  const mainPalette = ["teacher", "demo-report", "file-box", "teacher-guide", "build-your-own"].includes(screen) ? "teal" : "gold";

  return (
    <div className="min-h-screen text-stone-700" style={{ fontFamily: "ui-sans-serif, system-ui", background: "#FAF6EF" }}>
      <FontImport />
      <OuterFrame tone={mainPalette} />
      <AmbientIcons palette={mainPalette} />
      <CloseButton onClick={() => setShowCloseConfirm(true)} />
      {showCloseConfirm && (
        <CloseConfirmModal
          screen={screen}
          studentId={studentId}
          onCancel={() => setShowCloseConfirm(false)}
          onConfirm={() => {
            setShowCloseConfirm(false);
            try { window.close(); } catch (e) { /* window.close() is unreliable in sandboxed contexts, the fallback screen below handles this */ }
            setAppClosed(true);
          }}
        />
      )}
      {!authInfo && hasAuthenticatedOnceRef.current && (
        // The class's shared access-code session expired mid-use. Shown as
        // an overlay on top of the still-mounted main tree — deliberately
        // NOT the early-return swap used before first auth — so whatever
        // screen/word the student was on (its component state, e.g. a
        // CoachScreen mid-conversation with a word) survives underneath
        // and picks back up exactly where it was once the teacher re-enters
        // the code, instead of being unmounted and restarted from scratch.
        <div className="fixed inset-0 flex flex-col items-center justify-center p-6 overflow-y-auto" style={{ zIndex: 10000, background: "#FAF6EF" }}>
          <p className="font-body text-sm text-stone-600 bg-white rounded-full px-4 py-2 mb-2 text-center" style={{ border: "3px solid #0d9488" }} aria-live="polite">
            ⏳ Your class's session timed out. Nothing was lost, just re-enter the code to keep going.
          </p>
          <AccessGateScreen
            onUnlocked={(token, expiresAt) => {
              saveCachedAuth(token, expiresAt);
              setAuthInfo({ token, expiresAt });
            }}
          />
        </div>
      )}
      {screen !== "coach" && (
        <SoundToggle soundOn={soundOn} onToggle={() => { const next = !soundOn; setSoundOn(next); setSoundEnabledGlobal(next); }} />
      )}
      <main>
        {screen === "setup" && (
          <SetupScreen
            onBegin={handleBegin}
            customPassages={customPassages}
            onSaveCustomPassage={handleSaveCustomPassage}
            onViewDemoReport={() => setScreen("demo-report")}
            bilingual={bilingual}
            onToggleBilingual={() => setBilingual((b) => !b)}
            onStudentAuthenticated={(token, expiresAt, student) => {
              saveCachedStudentAuth(token, expiresAt, student);
              setStudentAuth({ token, expiresAt, student });
            }}
            onOpenFileBox={() => setScreen("file-box")}
            onOpenTeacherGuide={() => setScreen("teacher-guide")}
            onOpenBuildYourOwn={() => setScreen("build-your-own")}
          />
        )}
        {screen === "demo-report" && (
          <TeacherScreen
            studentId="Sample Student"
            log={SAMPLE_LOG}
            onBack={() => setScreen("setup")}
            onReset={() => setScreen("setup")}
            sessionStartedAt={Date.now() - 600000}
            comprehensionResult={SAMPLE_COMPREHENSION}
            isDemo
          />
        )}
        {screen === "file-box" && <FileBoxScreen onBack={() => setScreen("setup")} />}
        {screen === "teacher-guide" && <TeacherGuideScreen onBack={() => setScreen("setup")} />}
        {screen === "build-your-own" && <BuildYourOwnScreen onBack={() => setScreen("setup")} />}
        {screen === "passage" && (
          <PassageScreen
            passage={passage}
            solvedWords={solvedWords}
            onPickWord={(w) => {
              setActiveWord(w);
              setWordIndex(solvedWords.length);
              setScreen("coach");
            }}
            onOpenTeacher={() => setScreen("teacher")}
            onSwitchStudent={handleSwitchStudent}
            avatarConfig={avatarConfig}
            totalLogCount={log.length}
            streakMsg={streakMsg}
            studentId={studentId}
            log={log}
            sessionStartedAt={sessionStartedAt}
            revealedCount={revealedCount}
            onRevealNext={() => setRevealedCount((n) => n + 1)}
            bilingual={bilingual}
          />
        )}
        {screen === "coach" && activeWord && (
          <CoachScreen
            passage={passage}
            targetWord={activeWord}
            avatarConfig={avatarConfig}
            onWordResolved={handleWordResolved}
            onBack={() => setScreen("passage")}
            soundOn={soundOn}
            onToggleSound={(next) => { setSoundOn(next); setSoundEnabledGlobal(next); }}
            wordIndex={wordIndex}
            isTransferWord={activeWord && transferWordId === activeWord.word}
            bilingual={bilingual}
          />
        )}
        {screen === "comprehension" && (
          <ComprehensionScreen
            passage={passage}
            avatarConfig={avatarConfig}
            bilingual={bilingual}
            onDone={(result) => {
              setComprehensionResult(result);
              // Best-effort, same philosophy as the quota cache: a failed
              // save shouldn't block the recap screen the student is
              // waiting on, it just means this session won't show up in
              // the teacher's File Box later.
              if (studentAuth) {
                saveSession({
                  passageTitle: passage.title,
                  passageEmoji: passage.emoji,
                  startedAt: sessionStartedAt,
                  finishedAt: Date.now(),
                  comprehensionResult: result,
                  log,
                }).catch(() => {});
              }
              setScreen("recap");
            }}
          />
        )}
        {screen === "recap" && (
          <RecapScreen
            studentId={studentId}
            log={log}
            avatarConfig={avatarConfig}
            comprehensionResult={comprehensionResult}
            onFinish={() => setScreen("passage")}
          />
        )}
        {screen === "teacher" && (
          <TeacherScreen studentId={studentId} realStudentId={studentAuth?.student?.id} log={log} onBack={() => setScreen("passage")} onReset={handleReset} sessionStartedAt={sessionStartedAt} comprehensionResult={comprehensionResult} />
        )}
      </main>
    </div>
  );
}
