# The transport, cut in half — evidence

**Complete.** The rig's send side, the transport adapter, `Host` in the core,
`run`, and exit code 3. All eight predictions are resolved below; **one is
falsified and kept with its original wording.**

Pre-registration: `TRANSPORT-PREREGISTRATION.md`, Section 4 frozen and
untouched. Baseline `5d4367f0897ee07f44d841af43134959a801e6f2`, fetched
sha-pinned from codeload; archive sha256
`673eaed8b04d38406b565e8d15bbec33601de71345476ebe77c6639d77a60544`.

Verified at `1057921ba518ea624eeb7839ae17c1f42ae9989f`; archive sha256
`649fe7ded3fe4954a31b739bed9fcec82851f5ea8aa5d36a576d80f70440e38b`.

    refusals    41/41 carry a literal message
    selftest    196/196   (199 after RELEASE.md landed; 196 is what v0.3.0 shipped)
    leak-audit  0 of 28 fixtures leak, 0 disclosure paths, 0 escape paths
    ui          27/27
    parity      7/7 byte-identical
    server      51/51
    server-slow 2/2
    wire        24/24
    sitting A   14/16, real Chromium 141

## The collapse DELETED headers. It did not reorder them

`slice0/run.mjs:14-17` built an object from the ordered header array before
`node:http` saw it. Every prior description of this — *converted the ordered
array to an object*, in `decisions.md` and the handoff — is accurate and
undersells it.

`slice0/collapse-demo.mjs` sends one ordered array both ways at one receiver:

    sent               X-Tag: alpha | X-Other: mid | X-Tag: beta | x-tag: gamma
    object collapse    x-tag: gamma | X-Other: mid
    flat array         X-Tag: alpha | X-Other: mid | X-Tag: beta | x-tag: gamma

**Four occurrences in, two out, no error and no exception.** `X-Tag` and
`x-tag` are two JS keys and one HTTP header; `node:http` keeps the later key and
drops the earlier silently.

**Why slice 0 never saw it.** The base fixture's two `X-Tag` entries are
ADJACENT and IDENTICALLY CASED — the one arrangement an object survives. P2
passed on the narrowest input that could pass. **That is 9e**: a check green
because of the input it was handed, not because of what it checks.

## The rig was repaired IN PLACE, and the bar that allowed it

`TRANSPORT-PREREGISTRATION.md` §3 says fix `slice0/run.mjs` first.
`slice0/README.md` says the harness is frozen and editing it invalidates
`SLICE-0-EVIDENCE.md`. Both are in the same repo and they pulled against each
other.

**The repair was allowed because NO VERDICT MOVED.** P4 and P8 were falsified on
2026-09-04 and are still falsified. No assertion was edited. One observed detail
changed — the runtime adds one header now, not two — and it is corrected in
`SLICE-0-EVIDENCE.md` rather than left standing.

**Had a prediction flipped, that would have been the study**, not a repair, and
the answer would have been a separate live harness. **That is the bar for the
next edit to `slice0/`**, and it is stated in `slice0/README.md` rather than
here, because that is where someone about to edit it will look.

`slice0/adversarial.mjs` carried the same collapse and was repaired too, with
**output verified byte-identical before and after** — no fixture in that set has
a repeated or differently-cased header name, so the object form was a no-op
there. Changed anyway: leaving the mechanism in a sibling file is how it came
back after `probe-dup.mjs` had already caught it once.

## `Host` was not a runtime constant, and only the repair made that visible

Under a flat header array **`node:http` supplies no `Host`**, and
`setHost: true` does not restore it. A real HTTP/1.1 server answers the
resulting request with **400**; supplying `Host` explicitly reaches 200.
`SLICE-0-EVIDENCE.md` recorded two runtime-added headers on 09-04; it is one,
and `Host` was an artifact of the lossy send side.

**So a rig fix became core work.** `Host` is derived in `src/core/url.js` from
the normalized href, with its secret ranges sliced from the URL's and the slice
verified against `new URL(href).host` — an attribution that cannot be proved is
refused, never guessed.

**The adapter was the wrong home and the reason is measurable.** A secret can be
the hostname: `http://{{$env.H}}/p` gives `secretRanges [{start:7,end:22}]`
covering it, and the URL projection masks it. An adapter computing
`new URL(exact.url.text).host` produces plaintext with no ranges attached, on a
header the projection would then have to mask by a second rule that agrees with
the first on every fixture anyone thought to write. **That is B3's mutant with
the serial numbers filed off.**

`origin` is on EVERY projection header, `"workspace"` or `"derived"`. A field on
some entries reads as an annotation; on all of them it is a property of the
document. **It is also marked in both displays as `  (derived)`** — shipping it
as a `--json`-only field left the display asserting the user wrote `Host`, which
is the thing the field exists to prevent.

## THE RIG IS NOT AN ORACLE FOR SENDABILITY

A raw-socket receiver accepts anything written at it and never validates. **Every
P-WIRE row passed green against a request carrying no `Host`** — a request a
real server answers with 400. The defect was invisible to the oracle P-WIRE is
defined against.

`test/wire.mjs` therefore stands a real `http.createServer` beside the receiver,
and the row is named `W-REAL` and commented so it is not read as redundant.
**P-WIRE going green reads as "the send works" and on its own does not mean
that.**

This is the same class as slice 0's own qualification: measuring through
something that cannot express the defect.

## A leak channel opened in this release and was closed before `run` was written

node puts request values in transport-error prose:

    getaddrinfo ENOTFOUND secret-host.invalid
    connect ECONNREFUSED 127.0.0.1:1

A secret can be the hostname. `run` reduces a transport failure to a bare code,
and the code's SHAPE is checked rather than a list of known names being
maintained, so an unanticipated code is still safe. `e.message`, `e.hostname`,
`e.address` and `e.port` are never copied, and a selftest check pins that.

**Measured before `run` existed, not after.**

## Predictions — all eight resolved

| | | |
| --- | --- | --- |
| T1 | `run` touches at most two files in `core/` | **WRONG** — `Host` alone touched three: `url.js`, `prepare.js`, `exact.js`, and `run` was not written yet |
| T2 | `node:http` can express the ordered array | **right** — flat `[name, value, ...]`, order, repeats, casing and empty values all preserved |
| T3 | the adapter builds no request content | **right** — `wireHeaders` is a flattener; a selftest check pins no adapter imports the transport |
| T4 | the fixed rig surfaces a hidden disagreement | **right, narrowly** — on the EXISTING fixture it surfaced only the `Host` change; the hidden disagreements needed new fixtures to exist |
| T5 | `leak-audit` needs new fixtures | **right, wrong mechanism** — not response bodies. A secret can reach `Host` and a transport error. `test/wire.mjs` covers both; **the 28 leak-audit fixtures still cover neither** |
| T6 | the suite grows 12–25 checks | **right** — 171 → 196, and `wire` 0 → 24 |
| T7 | exit code 3 becomes reachable | **right** — `reqtrail run` against an unresolvable host exits 3 |
| T8 | the first transport reads ambient state or hardcodes a pinnable value | **right, and it was `Host`** — the value a transport would have hardcoded is exactly the one that had to move into the core |

**T1 is kept with its original wording.** Section 4 was frozen before `Host` was
known to be reqtrail's problem, so T1 says nothing about it. It is wrong on its
face and the reason is the interesting part.

## Ten selftest checks went red at once and none was a real failure

Adding one derived header shifted every index. They indexed
`projection.headers[0]` and pinned `.length`.

**That is 9d, and one of them sat directly beneath a comment explaining 9d.**

They were rewritten to select on `origin`. **Shifting the indices by one would
have been the same defect with a new number.**

## The 9d split was made once, and nothing ages a document into it

The drift guard on `BOUNDARY-EVIDENCE.md` was the LIVE half of the split 9d
prescribes. That was right on 09-07 and stopped being right when v0.2.0 was
tagged and published. The suite moved 171 → 184 and **the guard demanded a
published release's evidence be edited to quote a count that release never
had.** 9d's first error, one document later.

Converted to a freeze guard at 171. **The drift guard now points at this
document.**

**The class matters more than the instance:** every release turns the previous
release's evidence document frozen and leaves a drift guard aimed at it. **This
recurs at 0.4.0 unless the transition is part of the release procedure rather
than something a red check discovers.**

## SIX version-pinned claims, five of them on published surfaces

`src/ui/main.jsx` said *this release ... does not send them*. `README.md` said
it in four more places. All true when written; all false the moment `run`
shipped. **Nothing caught any of them, because no check reads prose.**

Found by accident: `F3` in the browser sitting PRINTS the page text, and a
human-readable dump caught what no assertion could.

**Then a sixth, in the file already "fixed".** `main.jsx:152` carried
*Nothing is sent by this release* four lines from the correction, read past
twice in one day, and found only because a check was written.

**A guard was enforcing the stale sentence.** `selftest.mjs:774` required the
README to contain the literal *This release sends nothing* and would have failed
the moment anyone corrected it. **A guard that pins the wrong sentence is worse
than no guard: it blocks its own correction.** Same shape as the `0.1.0 sends
nothing` pin 9d recorded — the second live instance of that shape in one day.

The new check forbids the SHAPE — `this release`, `current release`,
`arrives in N`, `ships in N` — in `README.md`, `src/ui/main.jsx` and
`src/cli/main.js`. It is deliberately crude: it cannot tell a true version claim
from a stale one, so it bans the form. That is the only thing a grep can know
and the only thing that has ever gone wrong here.

**The repairs state properties, not better version claims.** `resolve` sends
nothing because that is what the verb means.

## A duplicate check was written and deleted

"the CLI version and package.json agree" was added, then `package.json` was
broken on purpose to prove it bites. **Two checks fired.** `:881` already
covered it, end to end through the real binary, which is stronger than comparing
two constants. **9c: duplication is future disagreement.** Deleted, with a
comment at the site so it is not re-added.

What was kept is the hole `:881` does not cover: **the crash message is a
different string on a different path**, and v0.2.0's defect happened because it
held its own literal. The check pins that it interpolates `${VERSION}` and
forbids a literal digit there.

**Found only because the check was tested against a broken input.** Green would
have shipped two guards.

## `https` exited 3, and 3 was the wrong code

Found while verifying the release notes against the tree rather than re-reading
them, hours after the release was called complete.

    $ reqtrail run https-workspace.json
    not sent: transport.protocol
    exit=3

**Code 3 is documented as "send attempted and failed; nothing to edit; may be
transient". All three halves were false.** `send` throws on the protocol check
BEFORE opening a socket, so nothing was attempted; the fix is one character in
the workspace file, so there is something to edit; and it is not transient.

**Every product example in the README uses HTTPS**, so this was the first `run`
a new user would attempt, answered with an exit code whose documentation told
them there was nothing they could do.

**Two correct-looking pieces composed into a defect.** `send` refusing a
non-`http:` protocol is right. `run` mapping "did not send" to exit 3 is right
for a transport failure. Neither review caught it because neither is wrong
alone — the same shape as the `Host` case, where the core building no `Host` and
the array form adding none were each correct.

`run` now refuses through the core's refusal path — `transport.unsupported`,
path `url`, exit 1. **`resolve` is unchanged and still shows `https://`
requests**: the scheme is legal to display and not yet legal to send. `send`
keeps its own guard, because it is exported and `run` is not the only way in;
`test/wire.mjs` exercises it directly now that nothing reaches it through `run`.

Four rows added, and they are regression rows rather than new coverage.

## Carried, and not closed

- **The two mutation gaps are unchanged**, both still `uncovered` with arguments
  attached: the UI component's wiring, and continued consumption after a 413.
- **`leak-audit` has no fixture for a secret in `Host` or in a transport error.**
  T5's mechanism, above.
- **`node:https` is imported by nothing.** `send` refuses a non-`http:` protocol
  outright rather than downgrading. §5 excludes it for a second release; it is
  one import away and every product example uses HTTPS.
- **The UI cannot re-resolve after a file edit.** `createUiServer` captures the
  workspace text once at construction. The copy says restart, which is accurate
  for what ships. Re-reading is 0.4.0 or later and has a real question behind it:
  a file changing under a running inspector is at odds with the determinism the
  rest of this product leans on.
- **`test/wire.mjs` does not ship.** `files` has never included `test/`. The
  README's claim now rests on it and links it on GitHub rather than naming a
  tarball path. **A deliberate choice, recorded here so it stays one.**
