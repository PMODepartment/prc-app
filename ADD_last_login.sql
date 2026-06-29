-- ─────────────────────────────────────────────────────────────────────────────
-- Add the users.last_login column (activity tracking for User Management).
-- Run once in the Supabase SQL Editor (prod). Safe to re-run (IF NOT EXISTS).
--
-- Why: the original live DB was created from an early schema that never had this
-- column. Without it, getAllUsers() returns last_login = undefined for every row,
-- and admin.html's activity badge degrades to showing EVERYONE as "Active".
-- auth.js / login.html already write this column on each login, but the writes
-- were failing silently (column not found) until it exists.
--
-- After running: tracking starts from now. Existing users show "Approved"
-- (never-logged-in-since-tracking) until their next login, which stamps
-- last_login; thereafter the Active (≤7 working days) / Inactive (7+) badge works.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- Optional: seed the two known-recent accounts so they show "Active" immediately
-- (otherwise they show "Approved" until their next login writes last_login).
-- UPDATE users SET last_login = now()
--   WHERE email IN ('fmlozano@megawide.com.ph', 'pmodepartment2@megawide.com.ph');

-- Verify:
-- SELECT email, last_login FROM users ORDER BY last_login DESC NULLS LAST;
