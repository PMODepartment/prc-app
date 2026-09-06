"""Every coach-tour step must point at something that exists.

    python check_tours.py

WHY THIS EXISTS
---------------
CoachTour SILENTLY SKIPS a step whose selector matches nothing — no error, the
tour is simply shorter. So when the Evaluated phase was consolidated and
#bp-comparison and #bp-evaluation were deleted, their two steps sat in the tour
teaching nobody anything while the panel that replaced them went uncovered.
Nothing failed; the tour quietly lost a fifth of itself.

Selectors are resolved against the ids and classes the page can actually
produce, collected from id="..." / class="..." ANYWHERE in the file — including
inside JavaScript strings, because nearly every panel in bids.html is built by
innerHTML and never appears in the static markup — plus its own <style> blocks.

It also checks each step has a title and a body: an empty card is the other way
a step wastes a slot.
"""
import io, re, sys, glob

ID_RE = re.compile(r'id=[\]?["\']([A-Za-z_][\w-]*)')
CLASS_RE = re.compile(r'class=[\]?["\']([^"\'>]+)')
TOKEN_RE = re.compile(r'^[A-Za-z_][\w-]*$')
SEL_RE = re.compile(r'([#.])([A-Za-z_][\w-]*)')
STEP_RE = re.compile(r"\{\s*sel:\s*'([^']+)'(.*?)\}\s*,\s*(?=\{|\]|/\*)", re.S)


# Elements are also injected by the shared scripts (portal-guide.js creates the
# portal's own "?" button, coachmarks.js its card), so those files count as
# definitions too — a selector is only dead if NOTHING anywhere defines it.
SHARED_JS = sorted(glob.glob('assets/js/*.js'))
ASSIGN_ID_RE = re.compile(r"[.]id\s*=\s*['" + chr(34) + r"]([A-Za-z_][\w-]*)")
ASSIGN_CLS_RE = re.compile(r"(?:className\s*=\s*|classList[.]add[(])['" + chr(34) + r"]([^'" + chr(34) + r"]+)")


def injected_tokens():
    ids, classes = set(), set()
    for p in SHARED_JS:
        try:
            t = io.open(p, encoding='utf-8').read()
        except OSError:
            continue
        ids.update(ASSIGN_ID_RE.findall(t))
        ids.update(ID_RE.findall(t))
        for g in ASSIGN_CLS_RE.findall(t) + CLASS_RE.findall(t):
            for c in g.replace("'", ' ').split():
                if TOKEN_RE.match(c):
                    classes.add(c)
    return ids, classes


INJ_IDS, INJ_CLASSES = injected_tokens()


def defined_tokens(src):
    """Every id and class this page can produce.

    ⚠️ IT MUST NOT BE "does this token appear anywhere in the file". That was the
       first version and it FAILED THE TEST WRITTEN FOR IT: a code comment saying
       "these replaced #bp-comparison" made the dead id look alive. A token only
       counts when something DEFINES it.
    """
    ids = set(ID_RE.findall(src)) | set(ASSIGN_ID_RE.findall(src)) | INJ_IDS
    classes = set()
    for group in CLASS_RE.findall(src):
        for c in group.replace("'", ' ').split():
            if TOKEN_RE.match(c):
                classes.add(c)
    for block in re.findall(r'<style[^>]*>(.*?)</style>', src, re.S):
        classes.update(re.findall(r'\.([A-Za-z_][\w-]*)', block))
        ids.update(re.findall(r'#([A-Za-z_][\w-]*)', block))
    classes |= INJ_CLASSES
    for g in ASSIGN_CLS_RE.findall(src):
        for c in g.replace("'", ' ').split():
            if TOKEN_RE.match(c):
                classes.add(c)
    return ids, classes


def unresolved(sel, ids, classes):
    out = []
    for kind, tok in SEL_RE.findall(sel):
        if kind == '#' and tok not in ids:
            out.append('#' + tok)
        elif kind == '.' and tok not in classes:
            out.append('.' + tok)
    return out


problems = 0
# _preview_*.html are throwaway harnesses (git-ignored). They carry a subset of a
# real page's markup, so a step whose target lives in the half they omit reports a
# phantom miss — a guard that cries wolf on scratch files stops being read.
PAGES = [p for p in sorted(glob.glob('*.html')) if not p.startswith('_preview_')]
for path in PAGES + sorted(glob.glob('assets/js/*.js')):
    src = io.open(path, encoding='utf-8').read()
    if 'CoachTour.configure' not in src:
        continue
    ids, classes = defined_tokens(src)
    steps = STEP_RE.findall(src)
    print('%s - %d step(s)' % (path, len(steps)))
    for sel, rest in steps:
        missing = unresolved(sel, ids, classes)
        ok = True
        if missing:
            print('  !! %-34s nothing defines: %s' % (sel, ', '.join(missing)))
            problems += 1; ok = False
        for field in ('title', 'body'):
            if field + ':' not in rest:
                print('  !! %-34s has no %s' % (sel, field))
                problems += 1; ok = False
        if ok:
            print('  ok %s' % sel)

print('\n%d problem(s)' % problems)
sys.exit(1 if problems else 0)
