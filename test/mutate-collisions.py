import subprocess, shutil, pathlib, sys, re

# Repo root, derived from this file so the script runs anywhere. It was
# committed with a hardcoded container path, which meant it could not run
# for anyone — defeating the point of committing it.
ROOT = pathlib.Path(__file__).resolve().parent.parent
COL = ROOT / "extension/lib/collisions.js"
RUL = ROOT / "extension/lib/rules.js"
CAN = ROOT / "extension/lib/canonical.js"
POP = ROOT / "extension/popup/popup.js"
HTML = ROOT / "extension/popup/popup.html"

MUTATIONS = [
    ("drop the leading dot (suffix-confusable guard removed)", COL,
     'return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);',
     'return a.endsWith(b) || b.endsWith(a);'),
    ("exact-equality overlap only (subdomain matching ignored)", COL,
     'return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);',
     'return false;'),
    ("one-directional overlap (symmetry lost)", COL,
     'return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);',
     'return a.endsWith(`.${b}`);'),
    ("header names compared case-sensitively", COL,
     'keys.add(`${sideOf(entry)}\\u0000${entry.name.toLowerCase()}`);',
     'keys.add(`${sideOf(entry)}\\u0000${entry.name}`);'),
    ("invalid header entries counted toward collisions", COL,
     'if (isValidEntry && !isValidEntry(entry)) continue;',
     'if (false) continue;'),
    ("only ONE side of a collision is marked", COL,
     '    ids.add(collision.profileIds[0]);\n    ids.add(collision.profileIds[1]);',
     '    ids.add(collision.profileIds[0]);'),
    ("intra-profile repeats treated as collisions", COL,
     '        if (a.id === b.id) continue;',
     '        if (false) continue;'),
    ("collision sort dropped (non-deterministic order)", COL,
     '''  collisions.sort(
    (x, y) =>
      x.header.localeCompare(y.header) ||
      x.side.localeCompare(y.side) ||
      x.profileIds[0] - y.profileIds[0] ||
      x.profileIds[1] - y.profileIds[1]
  );
''', ''),
    ("marker omits the header name", COL,
     'return (\n    `Not applying: ${headers.length === 1 ? "header" : "headers"} ` +\n    `${headerList} also written by ${others.join(", ")} on an overlapping ` +',
     'return (\n    `Not applying: ${headers.length === 1 ? "header" : "headers"} ` +\n    `also written by ${others.join(", ")} on an overlapping ` +'),
    ("import refusal removed entirely", CAN,
     '  if (collisions.length > 0) {',
     '  if (false) {'),
    ("import collision check runs BEFORE per-profile validation", CAN,
     '  const seenIds = new Set();',
     '  if (findCollisions(doc.profiles.map((p) => ({ id: p.id, name: p.name, domains: normalizeDomains(p.domains || []), headers: p.headers })), (e) => validateHeaderEntry(e).valid).length > 0) { throw new Error("overlapping domains"); }\n  const seenIds = new Set();'),

    # ---- v0.1.6, FINDING-026: the write-path refusals are their own sentences.
    #
    # THE FIRST ONE IS THE FINDING ITSELF. If reusing the card marker on the
    # save path fails zero checks, then v0.1.6 has changed the prose without
    # pinning the thing that was wrong with it, and the defect can walk back in
    # on the next edit to either surface.
    ("save refusal falls back to the CARD MARKER (the FINDING-026 defect)", COL,
     '  const facts = collisionFacts(collisions, profileId, nameFor);\n  if (!facts) return "";\n  const { headers, others, headerList, moment } = facts;\n  const one = headers.length === 1;',
     '  return describeCollisions(collisions, profileId, nameFor);\n  const facts = collisionFacts(collisions, profileId, nameFor);\n  if (!facts) return "";\n  const { headers, others, headerList, moment } = facts;\n  const one = headers.length === 1;'),
    ("save refusal claims the profile is not applying", COL,
     '`Not saved: ${one ? "header" : "headers"} ${headerList} ${one ? "is" : "are"} ` +',
     '`Not applying: ${one ? "header" : "headers"} ${headerList} ${one ? "is" : "are"} ` +'),
    ("save refusal omits the header name", COL,
     '`Not saved: ${one ? "header" : "headers"} ${headerList} ${one ? "is" : "are"} ` +',
     '`Not saved: ${one ? "header" : "headers"} ${one ? "is" : "are"} ` +'),
    ("save refusal loses number agreement", COL,
     '`Not saved: ${one ? "header" : "headers"} ${headerList} ${one ? "is" : "are"} ` +',
     '`Not saved: ${one ? "header" : "headers"} ${headerList} is ` +'),
    ("save refusal omits the other profile", COL,
     '`also written by ${others.join(", ")} on an overlapping domain. Two ` +',
     '`also written by another profile on an overlapping domain. Two ` +'),
    ("save refusal omits the way out", COL,
     '`profiles cannot write the same header on ${moment}. Change the ` +\n    `header or the domains, then save.`',
     '`profiles cannot write the same header on ${moment}.`'),
    ("import refusal terminates itself (the double-period defect)", COL,
     '`${moment}` +',
     '`${moment}.` +'),
    ("import refusal omits the header name", COL,
     '`"${first.header}"${first.side === "response" ? " on the response" : ""} on ` +',
     '`${first.side === "response" ? " on the response" : ""} on ` +'),
    ("import refusal names only ONE side", COL,
     '`${nameOf(idA, nameFor)} and ${nameOf(idB, nameFor)} both write header ` +',
     '`${nameOf(idA, nameFor)} writes header ` +'),
    ("import refusal drops the further-collisions count", COL,
     '    (remaining > 0',
     '    (false'),
    ("import throw re-adds the duplicated wrapper sentence", CAN,
     '    throw new Error(describeImportRefusal(collisions, (id) => nameById.get(id)));',
     '    throw new Error("this file has profiles that would write the same header on overlapping domains, which has no defined winner. " + describeImportRefusal(collisions, (id) => nameById.get(id)));'),

    # ---- v0.2.0: SIDE. A request header and a response header of the same
    # name are different writes at different moments and must not collide.
    #
    # THE FIRST TWO ARE THE CHANGE ITSELF. If either fails zero checks, the
    # predicate has been extended without pinning what the extension is for,
    # and a later edit can collapse the sides again with nothing complaining.
    ("side ignored: everything buckets as a request header", COL,
     'keys.add(`${sideOf(entry)}\\u0000${entry.name.toLowerCase()}`);',
     'keys.add(`request\\u0000${entry.name.toLowerCase()}`);'),
    ("the legacy default flips: a sideless 0.1.x entry reads as response", COL,
     'return entry && entry.side === "response" ? "response" : "request";',
     'return entry && entry.side === "request" ? "request" : "response";'),
    # This one SURVIVED when first run, which is how a wrong justification in
    # the comment above it was found. It is pinned by an ordering check that
    # declares entries response-first, so bucket order disagrees with output.
    ("side dropped from the comparator (order follows input, not values)", COL,
     '      x.side.localeCompare(y.side) ||\n', ''),
    ("the moment is hardcoded back to \"request\" for mixed-side collisions", COL,
     '  const moment = mixed\n    ? "the same exchange"',
     '  const moment = mixed\n    ? "the same request"'),
    ("facts dedupe on name only, merging the two sides into one report", COL,
     '    const k = `${c.side}\\u0000${c.header}`;',
     '    const k = c.header;'),

    # ---- v0.2.0: the validator and the rule builder. These two changed
    # together because accepting a response entry while profileToRule() still
    # emitted one array would apply it on the WRONG SIDE, silently. The first
    # mutant here IS that defect.
    ("response entries are emitted as REQUEST headers (the wrong-side defect)", RUL,
     '  const requestHeaders = valid\n    .filter((entry) => sideOf(entry) === "request")\n    .map(headerEntryToModifyHeaderInfo);',
     '  const requestHeaders = valid\n    .map(headerEntryToModifyHeaderInfo);'),
    ("response headers are never emitted at all", RUL,
     '  if (responseHeaders.length > 0) action.responseHeaders = responseHeaders;\n', ''),
    ("an empty responseHeaders array is registered rather than omitted", RUL,
     '  if (responseHeaders.length > 0) action.responseHeaders = responseHeaders;',
     '  action.responseHeaders = responseHeaders;'),
    ("an unrecognised side is silently defaulted instead of refused", RUL,
     '  if (entry.side !== undefined && !VALID_SIDES.has(entry.side)) {\n    return { valid: false, reason: `unknown side "${entry.side}"` };\n  }', ''),
    ("append is allowed on response headers (asserting an unverified list)", RUL,
     '    if (sideOf(entry) === "response") {\n      return {\n        valid: false,\n        reason: `append is not supported on response headers in this release`,\n      };\n    }', ''),

    # ---- v0.1.6, FINDING-022: the popup containment tripwires.
    #
    # These mutants are the reason those checks exist. Each one leaves a popup
    # that renders, works, and silently scrolls its master toggle away again.
    # min-height is first because it is the declaration that looks redundant.
    ("main can no longer shrink (min-height: 0 removed)", HTML,
     '    min-height: 0;\n    overflow-y: auto;',
     '    overflow-y: auto;'),
    ("main no longer scrolls (overflow-y removed)", HTML,
     '    min-height: 0;\n    overflow-y: auto;',
     '    min-height: 0;'),
    ("the header becomes shrinkable again", HTML,
     '  header {\n    flex: none;',
     '  header {'),
    ("the status line becomes shrinkable again", HTML,
     '  footer {\n    flex: none;',
     '  footer {'),
    ("the popup body is no longer height-bounded", HTML,
     '    max-height: 600px;\n',
     ''),
    # OBS-E1 itself. The cap that fed on its own output collapsed the popup to
    # 107px at zero profiles, and every check below passed against it.
    ("the circular vh cap is reintroduced (OBS-E1)", HTML,
     '    max-height: 600px;',
     '    max-height: min(600px, 100vh);'),
    ("the status line moves INSIDE the scrolling region", HTML,
     '  </main>\n\n  <footer id="status-line">&nbsp;</footer>',
     '  <footer id="status-line">&nbsp;</footer>\n  </main>\n'),

    # ---- v0.1.6, FINDING-023: the notice and the stylesheet must agree.
    ("the migration notice stops naming the marker", POP,
     '`Click any underlined domain below to re-approve it.`',
     '`Click any gray domain below to re-approve it.`'),
    ("the underline the notice names is removed from .migrating", HTML,
     'text-decoration: underline dashed var(--ink-soft); text-underline-offset: 2px;',
     ''),
]

backup = {}
for _, f, _, _ in MUTATIONS:
    backup[f] = f.read_text()

def restore():
    for f, t in backup.items():
        f.write_text(t)

print(f"{'mutation':62s} {'applied':>8s} {'fails':>6s}")
print("-" * 80)
results = []
for name, f, old, new in MUTATIONS:
    restore()
    src = f.read_text()
    applied = old in src
    if not applied:
        print(f"{name:62s} {'NO':>8s} {'--':>6s}   <-- PATCH DID NOT APPLY")
        # FOURTH FIELD KEPT IN SYNC WITH THE APPLIED BRANCH. The summary
        # lines below unpack four. A three-tuple here would make the harness
        # throw on exactly the run where an anchor went stale — the condition
        # this branch exists to report.
        results.append((name, False, None, False))
        continue
    f.write_text(src.replace(old, new, 1))
    r = subprocess.run(["node", "test/selftest.mjs"], cwd=ROOT,
                       capture_output=True, text=True)
    out = r.stdout + r.stderr
    fails = len(re.findall(r"^FAIL:", out, re.M))
    tripwire = "count tripwire" in out
    # CRASH IS DETECTED BY ABSENCE OF A TERMINAL LINE, not by error name.
    # The previous test string-matched SyntaxError/ReferenceError/TypeError,
    # which only catches the throws someone thought to enumerate — a RangeError
    # or a bare `throw new Error()` read as a clean run. A selftest that
    # REACHES ITS END always prints exactly one of three terminal lines. If
    # none is present the suite died partway, whatever it died of, and the
    # fail count below is a floor rather than a measurement.
    finished = ("checks passed" in out or "checks FAILED" in out
                or "count tripwire" in out)
    crashed = not finished
    label = f"{fails}" + (" +tw" if tripwire else "") + (" CRASH" if crashed else "")
    print(f"{name:62s} {'yes':>8s} {label:>6s}")
    results.append((name, True, fails, crashed))

restore()
r = subprocess.run(["node", "test/selftest.mjs"], cwd=ROOT, capture_output=True, text=True)
print("-" * 80)
print("restored:", r.stdout.strip())
zero = [n for n, a, f, c in results if a and f == 0]
if zero:
    print("ZERO-FAIL MUTATIONS (uncovered):", zero)
# A CRASHING MUTANT'S COUNT IS NOT A COVERAGE NUMBER. The suite aborts where
# it throws, so every check after that point never ran and the printed figure
# is whatever happened to execute first. The "legacy default flips" mutant
# read as 2 while its real coverage was 18 — the crash hid sixteen failures,
# and the annotation sat in the table where nobody totalled it. Zero-fail gets
# a summary line because it means UNCOVERED; crash needs one too, because it
# means UNMEASURED, and unmeasured silently reads as covered.
crashing = [n for n, a, f, c in results if a and c]
if crashing:
    print("CRASHING MUTATIONS (count is a floor, not coverage):", crashing)
