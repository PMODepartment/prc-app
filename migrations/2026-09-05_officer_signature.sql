-- ============================================================================
-- The officer's own signature block, stored once — 2026-09-05
-- ----------------------------------------------------------------------------
-- Megawide's RFQ / RFP template ends with a full signature block: name, job
-- title, company, email, mobile, Viber, WhatsApp, website. The app could only
-- fill in the name and the email, so every officer was retyping the rest into
-- Outlook on every single invitation, or sending an RFQ without it.
--
-- Stored on the officer, NOT on the bid round: it is the same block on every
-- letter that person sends, and duplicating it per round would guarantee the
-- copies drift.
--
-- ⚠️ SELF-SERVICE, AND THAT IS SAFE. `users_update` already lets a user edit
--    their own row while its WITH CHECK forbids changing role / status /
--    projects (migrations/2026-07-08_rls_hardening.sql), so an officer can
--    maintain their own signature and still cannot escalate. These four columns
--    carry no authorization meaning whatsoever — they are contact details that
--    appear at the bottom of a letter.
--
-- ⚠️ NOT COPIED FROM auth.users OR Entra ID. A mobile number a vendor is asked
--    to call is a deliberate disclosure, so the officer types it themselves
--    rather than the app publishing whatever a directory happens to hold.
--
-- ⚠️ NULLABLE, no default, no back-fill. A blank line in a signature block is
--    silently omitted by the composer; an invented one would be worse than
--    absent, because a vendor would ring it.
--
-- Safe to re-run. Read-only for everything that does not already read users.*
-- ============================================================================

alter table public.users add column if not exists job_title       text;
alter table public.users add column if not exists mobile_number   text;
alter table public.users add column if not exists viber_number    text;
alter table public.users add column if not exists whatsapp_number text;

comment on column public.users.job_title is
  'Job title as it appears in the officer''s email signature (e.g. Portfolio Planning Engineer).';
comment on column public.users.mobile_number is
  'Contact number published to vendors in the RFQ / RFP signature block.';
comment on column public.users.viber_number is
  'Viber number for the signature block. Usually the same as mobile_number.';
comment on column public.users.whatsapp_number is
  'WhatsApp number for the signature block. Usually the same as mobile_number.';

-- ── verification: every column must read true ───────────────────────────────
select
  (select count(*) = 1 from information_schema.columns
    where table_schema='public' and table_name='users' and column_name='job_title')       as job_title,
  (select count(*) = 1 from information_schema.columns
    where table_schema='public' and table_name='users' and column_name='mobile_number')   as mobile_number,
  (select count(*) = 1 from information_schema.columns
    where table_schema='public' and table_name='users' and column_name='viber_number')    as viber_number,
  (select count(*) = 1 from information_schema.columns
    where table_schema='public' and table_name='users' and column_name='whatsapp_number') as whatsapp_number;
