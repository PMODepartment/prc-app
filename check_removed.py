"""Did an edit delete something that is still being used?

    python check_removed.py [git-ref]        # default HEAD

WHY THIS EXISTS
---------------
bids.html shipped with `bidsInPlay is not defined`. That function lived inside a
LINE RANGE deleted to remove a different function, so it went too — and every
panel in the Evaluated phase calls it, so the round page rendered its title and
then nothing at all.

`node --check` cannot catch this: an undefined identifier is a RUNTIME error and
the file parses perfectly. A full undefined-reference analyser is not the answer
either — you cannot reliably strip JS strings and comments with a scanner
because a regex literal such as /[^'"]/ contains quotes, and a naive stripper
swallows whole functions and reports them missing (tried; it produced seven
false positives).

So this asks a narrower question with a precise answer: WHAT DID THIS EDIT
REMOVE, AND IS ANY OF IT STILL REFERENCED? That is exactly the shape of the
mistake, and comparing two revisions of the same file needs no JS parsing at all.

Run it after any edit that DELETES a range of lines.
"""
import io, re, subprocess, sys

FILES = ['bids.html', 'vendors.html', 'vendor-portal.html', 'index.html',
         'project.html', 'review.html', 'wp-form.html', 'admin.html',
         'vendor-registrations.html', 'assets/js/db.js', 'assets/js/ui.js']


def js_of(text, path):
    if path.endswith('.js'):
        return text
    return '\n'.join(re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', text, re.S))


def defs(js):
    d = set(re.findall(r'\bfunction\s+([A-Za-z_$][\w$]*)', js))
    d |= set(re.findall(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=', js))
    return d



def _real_calls(js, name):
    """Calls to `name(` that are not obviously inside a comment.

    Not a parser: it drops a hit whose own line has `//` before it, or whose
    line is a block-comment continuation (leading `*` or `/*`). That removes
    the ordinary prose mentions this codebase is full of, and a stray miss here
    only ever costs a line of output for a human to dismiss — far better than
    the false NEGATIVE a real stripper risks.
    """
    pat = re.compile(r'(^|[^.\w$])' + re.escape(name) + r'\s*\(')
    n = 0
    for line in js.split(chr(10)):
        m = pat.search(line)
        if not m:
            continue
        head = line[:m.start()]
        t = line.strip()
        if '//' in head or t.startswith('*') or t.startswith('/*'):
            continue
        n += 1
    return n


def show(ref, path):
    r = subprocess.run(['git', 'show', ref + ':' + path], capture_output=True)
    return r.stdout.decode('utf-8', 'replace') if r.returncode == 0 else None


ref = sys.argv[1] if len(sys.argv) > 1 else 'HEAD'
problems = 0
for path in FILES:
    old_raw = show(ref, path)
    if old_raw is None:
        continue
    try:
        new_raw = io.open(path, encoding='utf-8').read()
    except OSError:
        continue
    old_js, new_js = js_of(old_raw, path), js_of(new_raw, path)
    gone = defs(old_js) - defs(new_js)
    if not gone:
        continue
    for name in sorted(gone):
        # A single-letter or very short name is almost always a local inside the
        # very block that was removed; only report a real, callable-looking one.
        if len(name) < 4:
            continue
        hits = _real_calls(new_js, name)
        if hits:
            print('!! %s: %s was REMOVED but is still called %d time(s)'
                  % (path, name, hits))
            problems += 1
        else:
            print('   %s: %s removed, no remaining calls' % (path, name))

print('\n%d problem(s)' % problems)
sys.exit(1 if problems else 0)
