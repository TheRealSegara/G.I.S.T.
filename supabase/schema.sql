-- G.I.S.T. database schema. Run this once in your Supabase project's
-- SQL Editor (Supabase dashboard -> SQL Editor -> New query -> paste
-- this whole file -> Run). Safe to re-run: every statement is
-- idempotent (create ... if not exists).
--
-- Access model: Row Level Security is enabled on every table below with
-- NO policies defined for the anon/authenticated roles, so the anon key
-- (safe to expose) grants zero access to this data. Only the service
-- role key, used exclusively by this app's own server-side API routes
-- (never shipped to the browser), can read or write these tables. All
-- authorization — which teacher can see which students, which student
-- can save to which session — is enforced in application code (api/*),
-- the same custom access-code/token model already used for the rest of
-- this app, not Supabase Auth or RLS policies.

create extension if not exists pgcrypto;

-- One row per class a teacher creates to group a subset of their own
-- students (e.g. "4A", "Reading Group 2") for File Box roster/report
-- purposes. Scoped to access_code_label the same way students are, since
-- one access code can represent a whole school where a teacher only
-- wants to see their own class's roster and stats, not everyone sharing
-- the code. A student is in at most one class at a time (or none --
-- see students.class_id below), not a many-to-many membership.
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  access_code_label text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists classes_access_code_label_idx on classes (access_code_label);

-- One row per student account. Scoped to the access-code label (the
-- teacher/school identity from ACCESS_CODES, see .env.example) rather
-- than a global namespace, so two different schools can each enroll a
-- student with the same name without collision or cross-visibility.
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  access_code_label text not null,
  full_name text not null,
  full_name_key text not null, -- normalizeName(full_name): lowercased/trimmed/collapsed, the actual lookup key
  avatar_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists students_access_code_name_key
  on students (access_code_label, full_name_key);

-- Students used to also carry a 3-animal "secret" as a kid-simple re-entry
-- check; removed in favor of identifying students by full name alone,
-- which the unique index above already guarantees can't collide. Safe to
-- re-run against a fresh database too (the column was never created there
-- in the first place, so this is a no-op).
alter table students drop column if exists secret_hash;

-- Added after the table already existed in earlier deployments; safe to
-- re-run against a fresh database too. Nullable and defaults to null, so
-- every already-enrolled student naturally starts "Unassigned" -- no
-- backfill needed, matching the fact that not every student has to be
-- in a class. ON DELETE SET NULL: deleting a class un-assigns its
-- students instead of deleting the student accounts themselves.
alter table students add column if not exists class_id uuid references classes(id) on delete set null;
create index if not exists students_class_id_idx on students (class_id);

-- One row per passage attempt (from picking a word to the whole-passage
-- comprehension check). diagnostic_report caches the AI-generated
-- summary once a teacher views it in the File Box, so revisiting the
-- same session later doesn't spend AI quota generating it again.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  passage_title text not null,
  passage_emoji text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  comprehension_result jsonb,
  diagnostic_report jsonb,
  teacher_notes text,
  -- Words a teacher has flagged for re-teaching from this session's
  -- report, e.g. ["sturdy", "anxious"]. Lowercase-free-form, matched
  -- against session_words.word the same loose way the rest of the app
  -- already compares words (case-insensitive), not a foreign key -- a
  -- flag survives even if the underlying word row is ever removed.
  flagged_words jsonb not null default '[]'::jsonb
);

create index if not exists sessions_student_id_idx on sessions (student_id);

-- Added after the table already existed in earlier deployments; see the
-- students.class_id column above for the same idempotent-migration
-- pattern. Defaults every already-existing session to an empty list.
alter table sessions add column if not exists flagged_words jsonb not null default '[]'::jsonb;

-- One row per target word attempted within a session. Mirrors the shape
-- of the in-memory `log` entries in src/App.jsx (see handleWordResolved).
create table if not exists session_words (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  word text not null,
  clue_type text,
  concreteness text,
  final_stage int,
  hints_used int,
  skipped boolean not null default false,
  -- Only meaningful when skipped is true: "manual" (student tapped Skip
  -- right away) vs "stuck_limit" (kept trying for STUCK_WORD_LIMIT
  -- exchanges and still couldn't land it) — see skipWord() in src/App.jsx.
  skip_reason text,
  revealed_meaning text,
  prior_knowledge text,
  got_it_via text,
  clue_identified text,
  transfer_passed boolean,
  time_to_answer_sec int,
  -- Total pacing-gate hold (both phases, summed across every exchange)
  -- actually enforced on this word, in seconds. Compared against
  -- time_to_answer_sec by the diagnostic engine to flag an answer that
  -- landed right at the enforced floor (essentially a guess-speed click)
  -- — see gateMsAccumRef/answeredAtGateFloor in src/App.jsx.
  min_gate_sec int,
  fun_fact text,
  solved_at timestamptz not null default now()
);

-- Added after the table already existed in earlier deployments; safe to
-- re-run against a fresh database too (the column is already present from
-- the create table above in that case, so this is a no-op there).
alter table session_words add column if not exists skip_reason text;
alter table session_words add column if not exists min_gate_sec int;

create index if not exists session_words_session_id_idx on session_words (session_id);

alter table classes enable row level security;
alter table students enable row level security;
alter table sessions enable row level security;
alter table session_words enable row level security;
