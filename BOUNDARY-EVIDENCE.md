# The request boundary — evidence

**Complete.** Items 4, 1 and 2. Item 3, the transport adapter, is 0.3.0 and no
transport code was written. All nine predictions are resolved below; **two are
falsified and kept with their original wording.**

Pre-registration: `BOUNDARY-PREREGISTRATION.md`, Section 4 frozen and untouched.
Baseline `734e75c3f847bd56e4d49eadab0bd1b1d22a9e86`, fetched sha-pinned from
codeload; archive sha256
`99325cc93417bac17a12f766c12572dea00abdcf06ab0fe1bdaba13ebc0e8971`.

## Item 4 — `prepared` is now `projection`

The name comes out of P-DERIVE's own wording. The pre-registration states the
property as `project(exact)` deep-equals the public view, so the field is named
for the function that produces it, and the check the release exists to write
reads as `project(exact)` deep-equals `result.projection`.

**`safeView` was considered and rejected on the release's own grounds.** It
names the guarantee rather than the derivation, and this project has now shipped
two false absolutes about exactly this boundary. A field asserting containment
in its own name is a third module-shaped absolute in different clothes, in the
release whose purpose is to replace absolutes with a measurable property.
`display` was the close second and was rejected on a narrower point: it collides
with `urlView.display` inside `prepare.js`, which is the value the field is
built from — the same word at two scopes, one derived from the other.

### What moved

| File | Change |
| --- | --- |
| `src/core/prepare.js` | the returned field; the file-header comment, which named a `PreparedRequest` that no longer exists |
| `src/cli/render.js` | three reads, and `renderPrepared` → `renderProjection` |
| `src/ui/logic.js` | the dispatch discriminant in `classifyResponse`, and the comment above it |
| `src/ui/main.jsx` | the `RequestLine` prop name and its four uses, and the call site passing it |
| `src/server/server.js` | a comment only — see B1 below |
| `test/selftest.mjs` | 18 reads |
| `test/ui.mjs` | one check, and its name |

Three occurrences of the word were left alone because they are ordinary English
and not references to the object: `errors.js:20-21` and `main.jsx:139` all use
*prepared* as a verb.

### Verification

Every suite re-run after the change, on the fetched archive with `npm ci` and
`scripts/build-ui.mjs` run so the UI half could execute:

    selftest    169/169        was 159 at v0.1.0; the boundary work adds 10
    server      51/51          unchanged
    refusals    37/37 carrying a literal message
    leak-audit  0 of 28 leaking, 0 disclosure paths, 0 escape paths
    parity      7/7 byte-identical
    ui          27/27          unchanged

**The baseline was run first and the same numbers recorded**, including
`server.mjs`'s stack-trace output, which is a passing suite's expected-error
printing and not a defect introduced here. Confirming that against a pristine
extraction is the point: a trace appearing in a diff-less run is otherwise
indistinguishable from one this change caused.

## Items 1 and 2 — the split

**The exact request already existed and was being thrown away.** That is the
finding, and it reframes what this release did.

- `normalizeUrl` computed `href` from real secret bytes, masked it locally into
  `display`, and returned only the masked form. The exact URL was discarded at
  the point it was most expensive to produce.
- `probe(segs, env)` computed the exact header value for the control-character
  and charset scans, then discarded it. The projection's header values were
  rebuilt independently from `masked(segs)`.

So the two halves were both being computed and neither was derived from the
other. **The second construction path was not a future risk; it was already
there**, one for the URL and one for the headers. The pre-registration described
item 1 as splitting one object into two. It was closer to the reverse: joining
two independent productions into a derivation.

### What now exists

`src/core/exact.js` — the exact request and `project()`, the only function that
substitutes a mask into request text. `normalizeUrl` returns `href` plus the
secret byte ranges and no longer masks anything. The unresolved-URL branch used
`masked()` directly, a third masking site, and now uses the same concatenation
helper the headers use.

`prepareRequest` returns **the pair as siblings**, `{ exact, view }`, not
`{ exact, ...publicFields }`. The flat shape was drafted first and rejected: it
is one spread away from putting secret bytes on stdout, since any consumer
writing `{ ...result }` carries it. Siblings mean reaching the exact request
requires naming it, and naming it is what the structural checks look for.

`inspect()` is the exported use case and consumes the pair, yielding only the
public half. `resolveWorkspace` is an alias, so every adapter is unchanged.
`run` will be the second consumer of the same pair in 0.3.0.

### Verification

    selftest    169/169        was 159 at v0.1.0; the boundary work adds 10
    server      51/51          unchanged
    refusals    37/37 carrying a literal message
    leak-audit  0 of 28 leaking, 0 disclosure paths, 0 escape paths
    parity      7/7 byte-identical
    ui          27/27          unchanged

### Three mutants, run rather than asserted

**M-A, the equivalent-output second construction path.** `prepareRequest`
rebuilds the projection from `masked(segs)` — identical bytes, genuine second
path. **It survived all 168 checks on the first attempt**, because the
structural check as first written forbade only `maskRanges` and the mutant did
not call it. The check was rewritten to name both maskers and to pin the single
`projection:` assignment site; the mutant then died on both. **The check that
kills M-A exists because M-A was run. Written from reasoning alone it would have
shipped weak and green.**

**M-B, the exact request stops carrying real bytes.** Dies — but by the charset
refusal, not by the positive control written for it, because the substituted
mask character is itself outside the header allowlist. **Recorded as a kill by
the wrong mechanism**: the positive control is not yet proven to fire on its own,
and a later change to the allowlist could turn this into a survivor without
anything noticing.

**M-C, the exact request leaks into the public result.** Dies on the new check
and independently on `leak-audit`, which goes to 2 of 28 with 2 disclosure
paths. Two independent detectors, one of them predating this release.

## Predictions — all nine resolved

**B1 — HELD, near-miss.** It named four files outside `core/`, including
`server/server.js`, which has no functional use of `prepared` — only a prose
comment — while `src/ui/main.jsx`, which B1 did not name, had the most uses. The
count is right and two of the named files are wrong. **Sixth mention-versus-use
collision on this project, and the first inside a prediction rather than a
grep.** The five before were greps matching a comment; this is the inverse.

**B2 — FALSIFIED.** It predicted P-DERIVE could be expressed against every
existing fixture without a new corpus. A new nine-case corpus was written.
**Falsified as executed, and the necessity was not tested** — whether
`leak-audit`'s 28 fixtures could have carried it was never measured, so the
honest statement is that the prediction was not met, not that it could not have
been. Recorded this way rather than argued down.

**B3 — HELD, and it is the most valuable prediction in the set.** It predicted a
same-output second path survives unless P-DERIVE is written as a derivation
check rather than an equality-of-values check. M-A survived exactly as
described. **An output comparison cannot distinguish a correct second path from
a derivation, because a second path computing the same bytes passes it on every
input tested.** What kills it is structural: one masking site, one assignment
site. That distinction is now written into the check's own comment.

**B4 — HELD.** `leak-audit` stayed at 0 of 28 with no fixture change.

**B5 — HELD on its wording, and the number did not improve.** `probe()`'s read
moved into the exact request's construction and stopped being a separate read.
But re-measurement shows **still eight `env[key]` sites, now across four modules
rather than three.** The move is not a reduction and the comment in `prepare.js`
now says so. Two releases have touched this and the count has not fallen once —
which is the argument for stating containment as a property of outputs, since a
module-list guarantee would have needed rewriting both times.

**B6 — HELD, both halves.** The suite grew by 10, at the top of the predicted
4–10 band, and the `EVIDENCE-0.1.0.md` count guard fired.

**B7 — HELD.** No transport code. `node:http`/`node:https` imports unchanged.

**B8 — FALSIFIED.** It predicted the first name would be wrong, chosen before
the derivation existed and then found to describe the old shape. `projection`
was taken from P-DERIVE's own wording rather than from the object in front of
it, and survived the sitting unchanged. **Taking the name from the property
instead of the code is why**, and that is the transferable part.

**B9 — HELD, for the first time in six sittings.** B2 and B8 are wrong, so *at
least one of B1–B8 is wrong* is right. The pre-registration recorded that this
meta-prediction had been wrong five sittings running by overestimating the error
rate, and that a sixth would mean replacing it. **It does not need replacing.**
The calibration reading is the opposite of the previous five: this sitting made
more wrong predictions than its predecessors, and the sitting where the
meta-prediction finally lands is the sitting that pushed hardest on things it
had not measured.

## Out of the pre-registered scope, and recorded here because it was

**The README asserted a schedule the 2026-09-07 ruling had reversed.** Two
sentences said `run` arrives in 0.2.0; the ruling moved it to 0.3.0. Both are
corrected to 0.3.0.

**This was not in the pre-registration and is written down for that reason.**
The justification is `import-fidelity-spike`'s rule — *a frozen artifact must
not stay wrong about itself*: correcting a false assertion changes no
measurement and invalidates no citation, where changing behaviour would. It is
a repair, not scope.

**CORRECTED 2026-09-07. The sentence above said "applied to a published one",
and that was wrong.** The repair reached the repository and NOT the published
package. npm serves the README from the published tarball, so `reqtrail@0.1.0`'s
page still tells every visitor `run` arrives in 0.2.0, and no repository commit
can change that. Verified against `registry.npmjs.org/reqtrail`, whose stored
readme still carries all five 0.1.0-pinned claims.

**Publishing is the only mechanism that corrects it.** That is now the strongest
argument for releasing 0.2.0 at all, since the release otherwise carries no
user-visible change beyond a `--json` field rename.

**No guard was added at the time, deliberately** — a guard encoding the version
roadmap would need editing on every schedule change. That reasoning was right
and it did not go far enough: the EXISTING guard was already the thing it warned
about. It required the literal string *"0.1.0 sends nothing"*, which is a lie in
every release after 0.1.0, so it would have blocked the very correction it
existed to protect. **A guard that must be disabled in order to fix what it
guards is worse than no guard.** Both the README claims and the guard are now
version-agnostic.

**How it was found:** by reading the README while surveying the rename surface,
not by any check. Nothing in the repo would have surfaced it.

## `projection` is a public field, not an internal name

`resolveWorkspace`'s return is serialized wholesale to `--json` stdout
(`render.js:56`) and to the server's 200 body (`server.js:293`), so this rename
is **observable to any `--json` consumer of the published 0.1.0**.

The README commits exit codes as interface *from this release onward* and makes
no equivalent commitment about the JSON shape. `schemaVersion` does not cover
it: that is the *workspace file's* version, an input contract, and there is
nothing today that versions the output. **So the rename is defensible and is
being taken deliberately rather than absorbed** — recorded here so that it is
a decision with a date on it rather than a diff.

**Carried into items 1 and 2:** the boundary release adds a private exact
request that must never be serialized to either channel. Whether the output
shape acquires its own version is a question for the end of this sitting, when
there is a second object for it to be wrong about.

## The count guard asked for the wrong fix, and was split rather than obeyed

Adding checks made `EVIDENCE-0.1.0.md quotes this suite's actual count` fail,
which is B6 firing as designed. **The fix it was asking for was wrong.**

`EVIDENCE-0.1.0.md` records `selftest 159/159`, and that is TRUE of v0.1.0 —
published, tagged, attested, its tree sha recorded in `decisions.md`. Editing it
to 169 would make a released artifact's evidence false about the release it
documents, in order to keep a check green.

The distinction is `import-fidelity-spike`'s: **a frozen artifact must stay
frozen, and it must not stay wrong about itself.** That document is frozen and
is not wrong. So the check was split in two:

- `EVIDENCE-0.1.0.md` gets a **freeze guard** pinning 159, so a later session
  cannot helpfully update it either.
- `BOUNDARY-EVIDENCE.md` — this document — carries the **drift guard** and must
  quote the live count.

**The general form, and it is the reusable part:** a drift guard must point at a
LIVE document. Pointed at a frozen one it eventually demands that history be
rewritten to match the present, and it makes that demand in exactly the voice of
a check that has caught a real defect. The guard was right that something was
out of date. It was wrong about which of the two things to change.

## Carried, and not closed

**The positive control for M-B is not proven to fire on its own.** M-B dies by
the charset refusal instead. A change to the header allowlist could turn it into
a survivor silently. This is the *prove the instrument can fire* rule, half-met.

**P-DERIVE is checkable but weak while nothing sends.** It proves the projection
is derived from the exact request. **It cannot prove the exact request is what
would actually go on the wire** — nothing in this release sends, so there is no
oracle for that half. The structural checks constrain the shape; slice 0 is the
only measurement tying any of it to real bytes, and it measured through a lossy
adapter.

**This is revisit trigger 1 in `decisions.md`, and it did NOT fire.** The trigger
is *P-DERIVE cannot be expressed without a transport consumer* — it can be, and
was. The weaker statement, that P-DERIVE is expressible but its exact-request
half is unverified until 0.3.0, is not a stop condition and was not treated as
one. **Recorded explicitly so 0.3.0 reads it as an inherited gap rather than
discovering it as a surprise**, and so nobody later reports this release as
having verified more than it did.

**The two carried mutation gaps are unchanged**, both still marked `uncovered`
with arguments attached: the UI component's wiring to its extracted decisions,
which needs a browser, and continued consumption after a 413, which nothing in
the suite can observe.

## Five value-pins in two days, four of them guards

Stated as a rule because it is a pattern, not a run of incidents. **The version
bump to 0.2.0 found three more of them in one command** — the release was the
instrument that exposed them, which is why the count below is five.

| Guard | Pinned | Should have pinned |
| --- | --- | --- |
| `EVIDENCE-0.1.0.md` count | the live suite total, in a frozen document | that the FROZEN document keeps its shipped number |
| `BOUNDARY-EVIDENCE.md` count | the first match in document order | every quoted count, historical ones marked |
| README no-transport | the literal string `0.1.0 sends nothing` | that the claim exists and names no version |
| `--version` check | the literal `"0.1.0"` | the SHAPE — one bare semver line |
| `bin/reqtrail.js` crash message | the version string, unguarded | `VERSION`, which it already had in scope |

**A guard must pin the property, not the artifact's current value of it.** Each
was green, each looked like it was defending something real, and each would have
failed on the next legitimate edit while reporting a defect. The README one is
the worst: it would have blocked its own correction. The `bin/reqtrail.js` one is
the quietest — no check covered it, so a 0.2.0 crash would have told the user to
report a bug in 0.1.0, and nothing would ever have failed.

Two were found by reading rather than by running — the README pin
while surveying for the release, the positional one during post-commit
verification. **Nothing in the suite finds this class**, because a guard pinned
to a stale value is indistinguishable from a guard that is passing.

## The new and rewritten guards were run against mutants

    MUT-1  README claim re-pinned to a version      dies
    MUT-2  README claim removed entirely            dies
    MUT-3  claim kept, second version-pinned claim  dies, on the second branch
    MUT-4  BOUNDARY-EVIDENCE sections reordered     survives (it must)
    MUT-5  live count edited to a wrong value       dies

MUT-3 exists because MUT-1 killed the check on the wrong branch: replacing the
sentence trips the presence test before the version-pinning test ever runs, so
the second branch was unexercised and would have been reported as covered.
MUT-4 is the defect that motivated the rewrite, now confirmed harmless.
