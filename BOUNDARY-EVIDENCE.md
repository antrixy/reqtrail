# The request boundary — evidence

**In progress.** This document covers **item 4 only**, the rename. Items 1 and 2
— the exact request as a first-class private value, the projection derived from
it by one function, and `inspect` expressed as a consumer of that pair — have
not been started. Predictions B2, B3, B5, B6 and B9 are therefore not yet
resolved and are recorded below as OPEN, not as held.

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

    selftest    159/159        unchanged from baseline
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

## Predictions — resolved so far

**B1 — HELD, but not for its stated reason. Recorded as a near-miss.** It named
four files outside `core/`: `cli/render.js`, `ui/logic.js`, `server/server.js`
and at least one test. Real uses exist in `render.js`, `logic.js`,
`selftest.mjs` and `ui.mjs` — four, so the prediction holds. But
**`server/server.js` contains no functional use of `prepared`, only a prose
comment**, and `src/ui/main.jsx`, which B1 did not name, has the most uses of
any file. The prediction was right about the count and wrong about two of the
files in it.

That is the **sixth mention-versus-use collision** in this project, and the
first one located in a prediction rather than in a grep. The five before it were
greps matching a comment; this is the inverse — a file listed as a use site on
the strength of a comment. **The same lookup that produces false positives for a
grep produces false confidence in a prediction**, and predictions are not run
through anything that would catch it.

**B7 — HELD.** No transport code written. `node:http` and `node:https` imports
are byte-identical to baseline; the full file-level diff against the pristine
extraction touches eight files and none of them is a transport path.

**B8 — HELD SO FAR, and it cannot be resolved yet.** It predicts the first name
will be wrong, *chosen before the derivation is built, then found to describe
the old shape*. `projection` describes the new shape by construction, having
been taken from P-DERIVE rather than from the current object. **But the
derivation does not exist yet**, so the condition B8 names has not been tested.
Resolve it at the end of items 1 and 2, not here.

**B2, B3, B5, B6, B9 — OPEN.** All depend on items 1 and 2.

## Out of the pre-registered scope, and recorded here because it was

**The README asserted a schedule the 2026-09-07 ruling had reversed.** Two
sentences said `run` arrives in 0.2.0; the ruling moved it to 0.3.0. Both are
corrected to 0.3.0.

**This was not in the pre-registration and is written down for that reason.**
The justification is `import-fidelity-spike`'s rule — *a frozen artifact must
not stay wrong about itself* — applied to a published one: correcting a false
assertion changes no measurement and invalidates no citation, where changing
behaviour would. It is a repair, not scope.

**No guard was added, deliberately.** `selftest.mjs:632` checks the sentence
*"0.1.0 sends nothing"*, which is still true, so nothing caught this. A guard
pinning the version roadmap would have to encode the current roadmap, and the
roadmap is the thing that just moved — it would need editing every time the
schedule changes, which is the maintenance shape the handoff's md5 table already
billed for. Recorded as a known uncovered drift class rather than closed.

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
