/* Every ti-* class used in the app must exist in the Tabler version we load.
   A missing one renders an EMPTY BOX with no error at all — which is how the
   Accreditation slide shipped with a blank icon.
   Usage: node scratchpad/check_icons.js            (needs scratchpad/tabler.css)
   Refresh the font: curl -s https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css -o scratchpad/tabler.css */
const fs = require('fs');
const css = fs.readFileSync('scratchpad/tabler.css', 'utf8');
const have = new Set([...css.matchAll(/\.ti-([a-z0-9-]+):+before/g)].map(m => 'ti-' + m[1]));
const files = process.argv.slice(2);
if (!files.length) { console.error('pass files to scan'); process.exit(2); }
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const used = [...new Set((src.match(/\bti-[a-z0-9-]+/g) || []))]
    .filter(u => !u.endsWith('-') && u !== 'ti-icons');
  const missing = used.filter(u => !have.has(u));
  if (missing.length) { bad += missing.length; console.log(f + '  MISSING: ' + missing.join(', ')); }
}
console.log(bad ? '\n' + bad + ' missing icon class(es)' : 'all icon classes exist in Tabler 2.44');
process.exit(bad ? 1 : 0);
