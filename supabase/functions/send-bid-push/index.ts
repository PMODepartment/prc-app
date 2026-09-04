/* ============================================================================
 * send-bid-push — turns a row in vendor_push_outbox into a Web Push.
 *
 * Invoked by ONE Supabase Database Webhook on INSERT into vendor_push_outbox.
 * See README.md in this folder for the deploy and the webhook settings.
 *
 * ⚠️ THE PUSH CARRIES NO PAYLOAD, AND THAT IS DELIBERATE.
 *    A payloadless push needs only a signed VAPID header. A push WITH a payload
 *    needs RFC 8291 content encryption — which is convenient to skip, but the
 *    real reason is that the message would travel through Google's or Apple's
 *    push infrastructure. "A new bid invitation is waiting" tells the vendor to
 *    look without putting a package name, a deadline or a figure on that wire.
 *    The service worker shows the generic notice; the portal shows the detail.
 *
 * ⚠️ IT ALWAYS RETURNS 200. A webhook that gets a 5xx is retried by Supabase,
 *    and a retry here would send the SAME notification again — a vendor being
 *    buzzed four times for one invitation is worse than one that failed. The
 *    outcome is recorded on the outbox row (sent_at / attempts / last_error),
 *    which is the thing to look at, not the HTTP status.
 * ========================================================================== */

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')     ?? 'mailto:pmodepartment@megawide.com.ph';
const SB_URL        = Deno.env.get('SUPABASE_URL')      ?? '';
const SB_SERVICE    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/* ── base64url ────────────────────────────────────────────────────────────── */
function b64uToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ── the VAPID JWT ────────────────────────────────────────────────────────
   ES256 over {aud, exp, sub}. WebCrypto's ECDSA sign already returns the raw
   r||s form JWS wants — do NOT try to DER-decode it. */
async function vapidHeader(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;   // spec caps this at 24h
  const header  = bytesToB64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64u(new TextEncoder().encode(JSON.stringify({ aud, exp, sub: VAPID_SUBJECT })));
  const signingInput = `${header}.${payload}`;

  // The private key is the raw 32-byte scalar (what gen_vapid_keys.js prints),
  // imported as a JWK together with the public point.
  const pub = b64uToBytes(VAPID_PUBLIC);           // 65 bytes, uncompressed 0x04||X||Y
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 point');
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: VAPID_PRIVATE,
    ext: true, key_ops: ['sign'],
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key,
                                       new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${bytesToB64u(sig)}`;
  return `vapid t=${jwt}, k=${VAPID_PUBLIC}`;
}

/* ── Supabase REST, with the service role ─────────────────────────────────
   ⚠️ Service role, so RLS does not apply. It is used for exactly two things:
      read this vendor's subscriptions, and write back the send result. */
async function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

Deno.serve(async (req: Request) => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    // Loud in the log, quiet to the caller — nothing to retry.
    console.error('VAPID keys are not set; see the README in this folder.');
    return ok({ skipped: 'no VAPID keys' });
  }

  let row: { id?: number; vendor_id?: string; kind?: string } = {};
  try {
    const body = await req.json();
    // Database Webhook shape: { type, table, record, old_record }
    row = body?.record ?? body ?? {};
  } catch (_) { /* fall through to the guard below */ }

  if (!row?.id || !row?.vendor_id) return ok({ skipped: 'no outbox row in the request' });

  // Devices that agreed to notifications, for this vendor only.
  const subsRes = await sb(`vendor_push_subscriptions?vendor_id=eq.${row.vendor_id}&select=id,endpoint`);
  const subs: Array<{ id: string; endpoint: string }> = subsRes.ok ? await subsRes.json() : [];
  if (!subs.length) {
    await sb(`vendor_push_outbox?id=eq.${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ sent_at: new Date().toISOString(), last_error: 'no subscribed devices' }),
    });
    return ok({ sent: 0, reason: 'no subscribed devices' });
  }

  let sent = 0, gone = 0;
  const errors: string[] = [];

  for (const s of subs) {
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          Authorization: await vapidHeader(s.endpoint),
          TTL: '86400',                 // hold it for a day if the device is off
          'Content-Length': '0',
          // Some push services reject a payloadless POST without this.
          'Content-Encoding': 'aes128gcm',
          Urgency: 'normal',
        },
      });
      if (res.status === 404 || res.status === 410) {
        // ⚠️ 404/410 means the browser threw the subscription away — the device
        //    was reset, the app uninstalled, permission revoked. Deleting it is
        //    the correct response; leaving it means retrying a dead endpoint on
        //    every future notification, forever.
        await sb(`vendor_push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' });
        gone++;
      } else if (res.ok || res.status === 201 || res.status === 202) {
        sent++;
      } else {
        errors.push(`${res.status} ${(await res.text()).slice(0, 120)}`);
      }
    } catch (e) {
      errors.push(String((e as Error).message ?? e).slice(0, 120));
    }
  }

  await sb(`vendor_push_outbox?id=eq.${row.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sent_at: sent > 0 ? new Date().toISOString() : null,
      attempts: 1,
      last_error: errors.length ? errors.join(' | ').slice(0, 500)
                : (sent === 0 ? `all ${gone} device(s) had expired` : null),
    }),
  });

  // ⚠️ Always 200 — see the header note. The result lives on the outbox row.
  return ok({ sent, expired: gone, errors: errors.length });
});
