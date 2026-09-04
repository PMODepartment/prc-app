# Vendor push notifications — deploy

Three steps. Everything else is already in the repo and in the database.

> **⚠️ No subscription is required.** Supabase Pro already includes Edge
> Functions, and the push services themselves (Google, Mozilla, Apple) are free.
> What this costs is a deployment step — the first thing in this project that
> lives outside the repo — not money. An earlier note in CLAUDE.md said a
> subscription was needed; that was wrong.

## 1. Generate the VAPID keypair

```bash
node gen_vapid_keys.mjs
```

**Run it once and keep the output.** Regenerating invalidates every device
subscription already stored, and every vendor would have to turn notifications
back on with nothing telling them why.

## 2. Deploy the function and set its secrets

Supabase dashboard → **Edge Functions** → *Deploy a new function* → name it
**`send-bid-push`** and paste `index.ts` from this folder. (Or, with the CLI:
`supabase functions deploy send-bid-push`.)

Then **Edge Functions → Secrets**, add:

| Secret | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | the public key from step 1 |
| `VAPID_PRIVATE_KEY` | **the private key — this is the secret** |
| `VAPID_SUBJECT` | `mailto:pmodepartment@megawide.com.ph` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically; do
not add them by hand.

## 3. Point one Database Webhook at it

Dashboard → **Database → Webhooks → Create a new hook**:

- **Table**: `public.vendor_push_outbox`
- **Events**: `Insert` only
- **Type**: Supabase Edge Functions → `send-bid-push`
- **Method**: `POST`

That is the only webhook needed. Everything that deserves a notification writes
to that one table (see the triggers in `migrations/2026-09-05_vendor_push.sql`).

## 4. Put the public key in the portal

In `vendor-portal.html`, replace the placeholder:

```js
const VAPID_PUBLIC_KEY = '';   // ← paste the PUBLIC key here
```

The public key is not a secret — the browser needs it to subscribe. Until it is
set, the portal simply does not offer notifications; nothing breaks.

---

## How it behaves

- **The push carries no payload.** A payloadless push needs only a signed VAPID
  header; a push *with* a payload needs RFC 8291 content encryption. Skipping
  that is convenient, but the real reason is that the message would travel
  through Google's or Apple's infrastructure. *"A new bid invitation is
  waiting"* tells the vendor to look without putting a package name, a deadline
  or a figure on that wire.
- **Three events notify, and nothing else**: an RFQ is issued, a buyer asks that
  bidder a clarification, the round is decided. A portal that notifies on every
  change trains the vendor to swipe them away — and then the one that mattered
  goes with them.
- **The function always returns 200.** A webhook that gets a 5xx is retried, and
  a retry here would send the *same* notification again. The result is recorded
  on the outbox row instead.
- **Expired devices are deleted.** A `404`/`410` from the push service means the
  browser threw the subscription away; keeping it would mean retrying a dead
  endpoint forever.

## If notifications do not arrive

Look at the queue, not the function log:

```sql
select id, vendor_id, kind, created_at, sent_at, attempts, last_error
  from public.vendor_push_outbox
 order by created_at desc limit 20;
```

- `sent_at` set → it went out; the device or its OS decided what to show.
- `last_error = 'no subscribed devices'` → nobody has turned notifications on
  for that vendor yet.
- rows piling up with `sent_at` null and `attempts = 0` → the webhook is not
  firing. Re-check step 3.

## iPhone

Web Push on iOS works **only after the vendor adds the portal to their Home
Screen** (Share → Add to Home Screen), and only on iOS 16.4+. In a normal Safari
tab there is no permission prompt at all. The portal says so rather than letting
the button appear to do nothing.
