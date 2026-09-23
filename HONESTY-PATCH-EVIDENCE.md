# 0.4.1 honesty patch — evidence

**Released 2026-09-23 as `reqtrail@0.4.1`**, tagged `v0.4.1` on
`2a85d12fafe56d9e524a4db0f6b7d6f9c3998249`. Eleven predictions are resolved
below; **one is falsified and kept with its original wording.** The release
steps outside the repo are recorded at the bottom, each with what was observed.

Pre-registration: `HONESTY-PATCH-PREREGISTRATION.md`, Section 4 frozen and
untouched since `a154493`. Baseline `bb0b6034ca6b748d756baed96c05ff5dc6b8bd18`
(0.4.0), codeload archive sha256
`3d820db34d2e5e1f3df4ac64ecaa61af2832b07e4572fdf1759689485252e74a`.

Verified at `84e7e5f2623635a88e6b0181b69f2b61a1bca60c`, archive sha256
`fd635f50fa77b3b42a7c69d668e83d1faea57c746d905670c0e4c68a9b67ea23`, plus the
commit that adds this file: the version bump to 0.4.1 in all four places and
the live drift guard pointed here. The counts below are from that combined tree
on Node 22.22.2, except sitting A: run on the release tree `fcafe17` on macOS,
Google Chrome, Node 24.4.1.

    refusals    43/43 carry a literal message
    selftest    220/220
    leak-audit  0 of 41 fixtures leak, 0 disclosure paths, 0 escape paths
    ui          27/27
    parity      7/7 byte-identical
    server      51/51
    server-slow 2/2
    wire        23/23
    wire-tls    16/16
    run-tls     12/12
    mutation    75/75 accounted for (1 equivalent, 2 uncovered)
    sitting A   15/17 held — F8 right; B10 (meta) wrong; F7 answered elsewhere

## What changed, and what a user sees

Every change removes a place where ReqTrail's output said something untrue or
unsafe. **No transport code changed**: `src/transport/http.js` is byte-identical
to 0.4.0.

- **Terminal output escapes CR, bidi controls and line separators.** A
  workspace key `x\rFAKE: all good` used to return the cursor and overwrite the
  `reqtrail:` prefix. Arguments echoed in usage errors are escaped too.
- **A secret is never named by code point.** A one-character secret `Ā` in a
  header produced a refusal containing `U+0100` — the whole value in another
  notation. The refusal now names the reference only.
- **The projection masks only bytes that are sent.** An empty secret showed
  `?k=••••` for a wire of `?k=`; a secret that normalized into a fragment showed
  `/a••••` for a wire of `/a`.
- **Userinfo is refused as `url.userinfo`.** 0.4.0 displayed `user:pw@` and sent
  neither the userinfo nor an `Authorization` header.
- **Invalid UTF-8 is refused as `workspace.encoding`, exit 1.** 0.4.0 replaced a
  raw `0x80` with U+FFFD and resolved it to `%EF%BF%BD`, exit 0.
- **The UI says it is a snapshot**, in the startup banner, the page header and
  the README. It serves the file as it was at startup.
- **Root-level refusal paths lose their leading dot**: `oops`, not `.oops`.
- **`--help` and the README no longer say `run` shows the request before
  sending it.** It never did: `run` awaits the send and prints afterwards.

**Two workspaces that resolved under 0.4.0 now refuse** — userinfo URLs and
invalid UTF-8. D0 ruled this a bug fix, because both were being processed into
output that the file did not express.

## PREDICTIONS — resolved

| # | Prediction | Verdict |
| --- | --- | --- |
| P1 | refusals 40 → 43 | held — 43 |
| P2 | `http.js` untouched; `src/` changes within the eight listed files | held — exactly those eight |
| P3 | exactly one existing check has its assertion changed | **WRONG** — two |
| P4 | the independent oracle fails on the baseline for CR and bidi, passes after D2 | held |
| P5 | D3 is one condition in `maskRanges`, needing only added checks | held |
| P6 | escaping CR changes no existing human-output check | held |
| P7 | a BOM is refused as `schema.json` before and after D1 | held |
| P8 | strict decoding changes no existing fixture's result | held |
| P9 | every new mutant is killed on its first run | held — 14 of 14 |
| P10 | the suite grows by 15–30 checks | held — 20 checks, plus 10 leak fixtures |
| P11 | at least one of P1–P10 is wrong | held — P3 |

**P3 is wrong for a procedural reason, not a product one.** The planned rewrite
("Host excludes userinfo", replaced by refusal checks under rule 9e) happened.
The unplanned one was the live drift guard: the first increment that added
selftest checks turned "HTTPS-EVIDENCE.md quotes this suite's actual count"
red, because it compared a **published** document against the live count.
Editing that document would have falsified a published record, so the guard
was frozen at 201, the count 0.4.0 shipped. That is an existing check with its
assertion changed, and P3 did not foresee it.

**P10's counting rule follows 0.4.0's** (HTTPS H9: "27 checks and 3 leak
fixtures"): checks and leak fixtures are counted separately. Checks: selftest
+19 (201 → 220, including the drift guard that points here) and wire +1
(22 → 23). Leak fixtures: +10 (31 → 41). The range holds either way — 20 checks,
or 30 counting fixtures as checks. **It is the first size prediction in six
releases that was not an underestimate**, which is one data point, not a
correction to the estimator.

**P9 was measured on the first complete run the harness has ever had.** Every
earlier run was stopped before it finished; see "What the pre-registration did
not foresee".

## Oracle bites — every new check was run against unfixed code first

| Increment | Check | Result on unfixed code |
| --- | --- | --- |
| 2 | independent terminal oracle, 7 new fixtures | 7 of 38 leaked (committed as `590a9e9`; CI test run 3 red) |
| 3 | 4 selftest checks (D3, D5), 2 equivalent-form fixtures | 4 failed; both fixtures leaked on all four channels |
| 4 | 3 userinfo refusal checks | all 3 "did not refuse" |
| 5 | 5 decoding and path checks | 4 failed; the BOM check passed on both sides (P7) |
| 6 | 2 `ui` banner checks | both failed |
| 7 | lockfile version check | failed: "lockfile says 0.1.0 and 0.1.0" |
| 8 | "a URL refusal shows a secret as the mask" | killed the pre-existing survivor |

Increment 5's baseline used a shim exporting `decodeWorkspace` with 0.4.0's
reading behaviour (`Buffer.toString("utf8")`), because the new tests import a
function 0.4.0 does not have. Increment 4's leak fixture (secret as the
password) was already clean on 0.4.0: it is a regression guard, not a bite.

## Corrections to the pre-registration, kept separate from it

- **D2 names the wrong echo site.** It says "the CLI argument echoed in the
  `ui` banner". In 0.4.0 the banner echoed no argument. The real echo sites
  were the usage messages in `src/cli/main.js` (unknown option, unreadable
  path), and the fix went there. Increment 6 later added a file name to the
  banner, escaped from the start.
- **D5 did more than it said.** Beyond hiding a secret's code point, it fixed a
  misattribution: the code point came from the first bad character in the whole
  header, so a literal could supply it while the message blamed a variable.
- **D9 missed a false sentence.** README "What is not here" listed
  `` `run` · sending anything `` from 0.3.0, when `run` shipped, until this
  release. It is on npm's pages for 0.3.0 and 0.4.0, where it cannot be edited.
- **The order of work was not followed.** Section 3 says one commit per
  increment. The upload workflow commits per folder, so increments landed as
  one to four commits each; see "Process".

## What the pre-registration did not foresee

**The live drift guard is a published-record trap, and RELEASE.md caused it.**
Fifth instance of the class, after `EVIDENCE-0.1.0.md`, `BOUNDARY-EVIDENCE.md`,
`TRANSPORT-EVIDENCE.md` and now `HTTPS-EVIDENCE.md`. The old step 2 pointed the
live guard at the releasing version's own evidence document, which is published
when the tag exists; step 3 froze only the previous release's guard. So every
publish left a live guard aimed at a published record, and the next release's
first new check turned it red. `RELEASE.md` now creates the evidence document
with the pre-registration (step 2) and freezes a release's own guard as the
first commit after publishing (step 17).

**The mutation harness had not been green since before 0.4.0, and no run had
finished to show it.** The first complete run (about eight minutes) found:

- two mutants whose anchors had not matched since 0.2.0 and 0.3.0 — masking
  moved to `exact.js`, and the render line became `const line = …` — reported
  as "did not apply" by every run that nobody finished;
- one real survivor: "a secret is rendered in place of the mask" (`masked()`
  rendering the environment key). Not a leak, since a key is not secret, but
  nothing pinned the display. A selftest check now kills it;
- two anchors matching twice. The harness replaces the first match, so a later
  edit above the intended site moves the mutant silently. Increment 5 did
  exactly that to "a refusal exits 0", which kept dying at the wrong site. The
  harness now refuses any anchor that matches more than once.

At 0.4.0 the honest result would have been three unaccounted mutants. It is
now 75/75.

**Three existing oracles could not see the defects they were meant to catch.**

- `leak-audit`'s terminal check was a character-for-character copy of the
  escaper's regex, so it inherited the missing CR. It is now written from
  Unicode properties and shares no text with the implementation.
- `leak-audit`'s human channel captured stderr only when the command failed,
  so warnings printed on a successful resolve were never inspected. It now
  captures both streams on every exit.
- `leak-audit` looked for a secret's bytes. A code point is not its bytes. It
  now also looks for the `U+XXXX` notation of every non-ASCII character in a
  secret fixture's environment.

**The release's own surface check found `run`'s help text false — and a check
holding it in place.** `--help` said "run shows it and then sends it" and the
README said `run` "shows you the same thing and then sends it". Both describe
the order the product claims, not the order it has: `run` awaits the send and
prints the request afterwards, which is the review's RT-A1, fixed in the
execution release. The selftest check "help says nothing is sent" **required
the literal false sentence**, so correcting the text turned it red — the same
shape as the `0.1.0 sends nothing` pin. It now pins "resolve shows the request
and never sends it.", which is what its name meant, and names no order for
`run`, so the execution release can reorder `run` without meeting a guard
against the correction. This is a third existing check with its assertion
changed; P3 was already falsified, and this does not change the verdict. Found
by reading the GitHub About text for step 6, which says the request is shown
"before anything is sent".

**The lockfile said 0.1.0 through three releases.** `npm ci` accepts the
mismatch and `npm pack` leaves the lockfile out, so no install or tarball check
could see it. `RELEASE.md` step 1 now lists four version strings in three
files, and a selftest check compares them.

**The wire DNS row depended on the machine's resolver.** A reviewer's
environment answered `secret-host.invalid` with HTTP 502, failing the row with
no defect in ReqTrail. The row now uses a closed loopback port, and a new row
measures that node's own error message carries the target, so the no-leak
assertion is shown able to fail.

## Process

Increments were committed through the GitHub web upload, which commits one
folder at a time. Three intermediate commits were red on CI:

| Commit | CI | Why |
| --- | --- | --- |
| `590a9e9` | test run 3, failed | new oracle before the escape fix — the intended baseline |
| `47237c8` | test run 6, failed | escape fix before the `main.js` argument fix |
| `e281fb7` | test run 9, failed | userinfo refusal before its rewritten check |
| `d4fd3e3` | test run 22, failed | version bumped in `package.json` before `src/cli/main.js` |

From increment 5 onward, uploads were ordered so that every commit is green:
source first where the old tests still pass against it, tests last. **For a
rewrite increment no order is green**, because the rewritten check and the fix
depend on each other. The version bump is the same shape: `package.json` and
`src/cli/main.js` must change together, and a single upload from the repo root
still split by folder. Every commit was verified afterwards from a sha-pinned
codeload archive and a clean `npm test`.

## Carried

- **Everything the second-pass review sequences after this patch**: display
  before send, acknowledged output and EPIPE (still a stack in 0.4.1), delivery
  state, a total deadline, the exact transport request (bare `?`, IPv6, framing
  headers), component-aware provenance, resource caps, exit code 4,
  duplicate-flag refusal, versioned JSON.
- **The ENOTFOUND class has no hermetic row.** It returns with an injected
  resolver in the execution release.
- **The wire, TLS and parity suites are outside the mutation harness.**
- **`wire.mjs` has no count tripwire**; its growth from 22 to 23 is pinned by
  nothing.
- **The first mutant's name does not match its edit.** "whitespace inside a
  reference is accepted" mutates the UI selection sequencer in `main.jsx`.
  Predates this release.
- **`main.jsx`'s new snapshot sentence is checked only by the browser sitting**
  (row F8, added in this release). `main.jsx` is a known mutation gap.
- **UI change detection.** 0.4.1 only states the snapshot.
- **The planning spec's "deterministic serialization" line** is corrected in
  `project-planning`, not here.
- **The sitting ran on Node 24; CI runs only Node 22.** The engine range is
  `>=22` with no upper bound and no matrix — the review's RT-B6 runtime item.

## Release steps outside the repo — DONE

Following `RELEASE.md`. Each line is filled in when the step is done, with
what was observed.

- **Step 5, browser sitting: DONE, 15/17 held, gate passes.** Run on the
  release tree `fcafe17`, confirmed before running by its codeload archive
  sha256 (`b68a01bc…c9a16f`), version `0.4.1` and the presence of row F8.
  Google Chrome on macOS, Node 24.4.1.

      B1–B9   all RIGHT
      F1 F2 F6 F3 F8 F4 B5   all RIGHT
      F3      shows: "reqtrail f.json This view shows requests. It does not
              send them — run reqtrail run to send."
      F8      shows: "This is the file as it was when reqtrail ui started.
              Edits to it do not appear here — restart reqtrail ui after
              editing."
      F7      ANSWERED ELSEWHERE (test/ui.mjs)
      B10     WRONG — "0 of B1-B9 wrong"; a meta-prediction, excluded from
              the gate by name

  **F3's dump ends exactly where the new sentence begins**, which is the reason
  F8 was added: `RELEASE.md` step 5 relied on F3's page text, and F3 alone would
  have shown nothing about 0.4.1's change.

  **The step failed twice on setup before it ran, and the first attempt used the
  wrong tree.** The command given had a placeholder `CHROMIUM_PATH`, taken
  literally; then `dist/index.html` did not exist, because `dist/` is gitignored
  and only `npm test`'s `pretest` builds it. The first attempt also ran in an old
  `reqtrail-0.4.0` checkout, whose sitting has no F8. `RELEASE.md` step 5 now
  gives the build step, a real macOS path, and the release-tree requirement.

  **The sitting's result stands for the tagged tree.** The commits after
  `fcafe17` change `--help` text, the README, a selftest check and this file;
  none touches `src/ui/`, `src/server/` or the sitting.
- **Step 6, surfaces no check reads: DONE.** The About text read "…before
  anything is sent", false for `run` in the same way as the help text above. It
  now reads: "Shows the HTTP request it hands to the transport — method, URL,
  headers — and where every substituted value came from. resolve never sends;
  run sends and reports the status. Local-first, plain JSON workspaces, CLI
  plus a loopback web UI." Read back from the public page after saving.
- **Step 7–8, release notes: DONE.** Every sample was captured from the binary
  at `2a85d12`, and each claim was checked against that tree, including the
  "still true in 0.4.1" list (`src/transport/http.js` is unchanged since 0.4.0,
  where those behaviours were measured).
- **Steps 9–11, tag: DONE.** Before creating it, raw.githubusercontent returned
  404 for `v0.4.1` and `main` was `2a85d12`. After: the tags page and the
  release page both resolve `v0.4.1` to `2a85d12`; a cache-busted
  raw.githubusercontent LOOKUP of `src/core/prepare.js`, `src/cli/main.js`,
  this file, `README.md` and `package.json` matched `2a85d12` byte for byte;
  VERIFICATION is the sha-pinned codeload archive of `2a85d12` (sha256
  `f2f1515a510af63238c8c9caeea87829b00522eae6e32d02fd2f7ae6b070498e`), on which
  a clean `npm test` passed in full.
- **Steps 12–13, publish: DONE.** The `publish` workflow ran from `main` at
  `2a85d12` in 1m 20s and printed `+ reqtrail@0.4.1`. Tarball: 33 files,
  shasum `0b43b4213dd3e31a106c49f8b0f0a327cb66306f`, provenance statement at
  sigstore log index 2924119739.
- **Step 14, registry tarball against the tag: DONE.** `npm view` returned the
  same shasum; the downloaded tarball's sha1 matches it. Of its 33 files, **28
  are byte-identical to the tag**, and the other 5 are the built `dist/` files
  (gitignored, so not in any tag). Those 5 are byte-identical to a local
  `build:ui` of the tag with the locked esbuild 0.28.2, so the UI bundle is
  reproducible from the tagged source.
- **Step 15, the published binary: DONE.** `npm install reqtrail@0.4.1` in an
  empty directory, then: `--version` printed `0.4.1`; a userinfo URL refused
  with `[url.userinfo]`, exit 1; an invalid-UTF-8 file refused with
  `[workspace.encoding]`, exit 1; `--help` says run "sends it over http or
  https, then shows it with the response status".
- **Step 17, freeze this document's drift guard: DONE**, in the first commit
  after publishing, at 220. The live guard is unpointed until the next
  pre-registration.
- **Still on npm and not editable**: the 0.3.0 and 0.4.0 pages carry the README
  saying `run` does not exist. This file is not in the tarball (`package.json`
  `files` ships only slice 0's evidence), so at the tag it reads PENDING for the
  steps above and this record lives on `main`.
