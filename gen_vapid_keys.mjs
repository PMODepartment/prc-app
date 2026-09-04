/* Generate the VAPID keypair for vendor push.  node gen_vapid_keys.mjs
 *
 * ⚠️ RUN IT ONCE AND KEEP THE OUTPUT. Regenerating invalidates every device
 *    subscription already stored — every vendor would have to turn
 *    notifications on again, and nobody would be told why.
 *
 * ⚠️ THE PRIVATE KEY IS A SECRET AND MUST NOT BE COMMITTED. It goes into the
 *    Edge Function's environment (Supabase → Edge Functions → Secrets). The
 *    PUBLIC key is not a secret — it is meant to be in the page.
 *
 * This script itself is data-free and is committed; its output is not.
 */
import { webcrypto as crypto } from 'node:crypto';

const b64u = (b) =>
  Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
// 65 bytes, uncompressed 0x04||X||Y — the form the push spec and the browser want.
const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
const priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;   // raw 32-byte scalar, base64url

console.log('');
console.log('VAPID_PUBLIC_KEY   (public — also goes in vendor-portal.html)');
console.log('  ' + pub);
console.log('');
console.log('VAPID_PRIVATE_KEY  (SECRET — Supabase Edge Function secret only)');
console.log('  ' + priv);
console.log('');
console.log('VAPID_SUBJECT      (a contact the push service can reach you at)');
console.log('  mailto:pmodepartment@megawide.com.ph');
console.log('');
console.log('Next: supabase/functions/send-bid-push/README.md');
console.log('');
