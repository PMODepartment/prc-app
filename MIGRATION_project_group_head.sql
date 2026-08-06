-- ─────────────────────────────────────────────────────────────────────────────
-- Group Head tag on projects
--
-- Adds a free-text `group_head` column to public.projects holding the name of the
-- Group Head that owns the project. The app offers the six canonical names
-- (Tan, Rodrin, Ronquillo, Calimag, Fellowes, Flores) via a dropdown — see
-- window.GROUP_HEADS in assets/js/db.js, which is the single source of truth for
-- the option list. The column is deliberately plain `text` (not an enum / FK) so
-- the roster can change without a DB migration; blank/NULL means "Unassigned".
--
-- Idempotent — safe to re-run.
-- Run once in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS group_head text DEFAULT NULL;

COMMENT ON COLUMN public.projects.group_head IS
  'Group Head that owns this project (free text; option list lives in window.GROUP_HEADS in db.js). NULL = unassigned.';

-- Optional: backfill examples — edit and uncomment as needed.
-- UPDATE public.projects SET group_head = 'Tan'       WHERE id IN ('AVR101','AVR102');
-- UPDATE public.projects SET group_head = 'Ronquillo' WHERE id IN ('QHL706');
