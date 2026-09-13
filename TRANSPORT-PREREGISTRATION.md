# The transport — pre-registration

**Written before the change and before it was run. Section 4 is frozen.**
Baseline `2876a83d37eda32029e84247fc2985d53231ab2f`, tag `v0.2.0`, tree sha256
`875b78de5e64d389e7b7b917851a111dbe2a7ced0fe55718f5636a5075004758`.

Scope ruled in `decisions.md`, *reqtrail 0.3.0 — the transport, cut in half*,
2026-09-08: **plain HTTP send with the ordered header array, verified against
the slice-0 rig. `node:https` and response-handling limits are 0.4.0.**

## 1. The divergence

**0.2.0 proved the projection is derived from the exact request. Nothing proves
the exact request is what would go on the wire.** `BOUNDARY-EVIDENCE.md` records
this as an inherited gap rather than a discovery: P-DERIVE is checkable with
nothing sending, but its exact-request half has no oracle until something sends.

Slice 0 is the only measurement tying any of it to real bytes, and **it measured
through a lossy adapter on the send side.**

    slice0/run.mjs:14-17
      const headers = {};
      for (const x of m.headers) { ... }        // ordered array -> object

**A CORRECTION TO THE SCOPE AS WRITTEN.** `decisions.md` and
`handoffs/reqtrail/NEXT.md` both describe 0.3.0 as *"rebuilding the slice-0
differential rig against a raw-socket receiver."* The receiver is already
raw-socket — `slice0/receiver.mjs:1` reads *"Raw-socket receiver. NOT
http.createServer"*, uses `net.createServer`, captures verbatim bytes, and cites
the F15 failure mode as its reason. **The rig was never wrong at the receiving
end.** The loss is entirely on the send side, in an 89-line file. Both planning
documents are wrong about which half needs work, and should be corrected rather
than followed.

Slice 0's Go was qualified by two NOT REACHED rows. **P6** — punycode host,
untestable against `127.0.0.1` — remains open against the rig. **P9** —
`--as-curl` parity — is retired as of 2026-09-08: it travels with a feature that
is parked, so it is work with no subject rather than unmet work.

## 2. The change, stated as a property of OUTPUTS

**P-WIRE.** For every request in the corpus, the bytes a raw-socket receiver
captures agree with the exact request the core built — **method, target, and the
header block compared as an ordered sequence of name/value pairs**, preserving
name casing, relative order across different names, and repeated occurrences.

Stated this way deliberately. *"The adapter passes the array through"* is a
claim about a module and is the shape this project has stated wrongly three
times. **P-WIRE is a claim about captured bytes**, and a receiver that parses
before comparing cannot check it — which is why the rig's receiver is raw and
must stay raw.

**P-CONTAIN is unchanged and extends to the new surface.** No public result,
protocol response, renderer, log or general-purpose error contains secret bytes.
`run` adds response handling, which is a **new public surface**, and a response
body echoing a request header is the obvious way for a secret to arrive back.

**Exit code 3 becomes reachable for the first time.** `src/cli/main.js` has
carried it since 0.1.0 as UNREACHABLE. Every assertion that nothing is sent —
in the README, in `enumerate-refusals`, in the exit-code checks — is now a claim
about behaviour rather than a statement of fact.

## 3. The scope, as ruled

**0.3.0 = plain HTTP send with the ordered header array, verified against the
existing rig.** `node:https` and response-handling limits move to 0.4.0. Full
reasoning and the two rejected options are in `decisions.md`; the short form:Item 3 as written adds **five new failure surfaces** where 0.2.0 added
none: a network, TLS, timeouts, response limits, and the first reachable failure
exit. TLS is the only one with no existing machinery anywhere in the repo — a
self-signed certificate in the rig is new work with its own failure modes, and
it is separable, because P-WIRE over plain HTTP is the same property.

**Rejected: all of item 3 in 0.3.0.** It puts the strongest oracle (byte
comparison against a raw capture) in the same release as the weakest (TLS, which
the rig cannot currently observe at all). That is the same argument that
produced the 0.2.0/0.3.0 split and it has not changed.

**Rejected: cut `run` and ship only the adapter.** A transport adapter with no
consumer is unfalsifiable — nothing would send through it, which is the exact
condition 0.2.0 already lives under.

### Order of work

1. **Fix `slice0/run.mjs` first**, before any product code. The rig is the
   oracle; measuring against a rig known to be lossy is how the Go was qualified
   in the first place.
2. Then the transport adapter, then `run` as the second consumer of the pair.
3. Exit code 3 and its documentation last, because its shape depends on what
   the transport actually does.

## 3b. ADDENDUM — how §3's order of work was actually executed, 2026-09-08

**Written after the release, appended rather than edited into §3, so what was
pre-registered stays legible as what was pre-registered.**

§3 item 1 says fix `slice0/run.mjs` first. **It was executed as an IN-PLACE
repair**, which pulled against `slice0/README.md` declaring the harness frozen
and against `SLICE-0-EVIDENCE.md` reporting its output.

**Allowed because no verdict moved.** P4 and P8 were falsified on 2026-09-04 and
are still falsified; no assertion was edited; the one observed detail that
changed — the runtime adds one header, not two — is corrected in the evidence
rather than left standing. **Had a prediction flipped, that would have been the
study rather than a repair**, and the answer would have been a separate live
harness.

`slice0/adversarial.mjs` carried the same collapse and was repaired too, with
**output verified byte-identical before and after**.

**The bar for the next edit to `slice0/` is stated in `slice0/README.md`**, and
the ruling is in `decisions.md`. Neither is restated here.

**§4 IS UNTOUCHED.** T1 is falsified as written and is kept with its original
wording — it predicted `run` would touch at most two files in `core/`, and
`Host` alone touched three before `run` existed. §4 was frozen before `Host` was
known to be reqtrail's problem, so T1 says nothing about it. **That is what a
frozen prediction is for.**

## 4. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| T1 | `run` as a second consumer of the pair touches **at most two files in `core/`** and adds no new construction path. 0.2.0 was built for exactly this | medium-high | three or more, or any second construction path appears |
| T2 | `node:http` preserves the ordered array's interleaving of different header names well enough for P-WIRE to pass without a raw-socket writer | medium | interleaving is lost and the adapter has to write bytes directly |
| T3 | Making exit code 3 reachable touches **more files than the transport adapter itself** — README, `enumerate-refusals`, exit-code checks, `src/cli/main.js` | medium-high | it touches fewer |
| T4 | Fixing `slice0/run.mjs` surfaces **at least one disagreement the object conversion was hiding** | medium | the fixed rig agrees on every row the lossy one did |
| T5 | `leak-audit` needs **new fixtures for the first time**, because response bodies are a new public surface | medium-high | the existing 28 cover it |
| T6 | The suite grows by 12–25 checks | medium | growth outside that range |
| T7 | The carried 413 gap — continued consumption after a 413 — becomes observable and closes | medium | it remains `uncovered` |
| T8 | The first transport implementation reads ambient process state somewhere, or hardcodes a value a guard should pin | low-medium | neither appears |

**T9, the meta-prediction: at least one of T1–T8 is wrong.**

**Confidence: medium, and the record has changed.** This was wrong five sittings
running by overestimating the error rate, then **right on the sixth** — B2 and
B8 both failed. The pre-registration had said a sixth miss would mean replacing
it as measuring nothing. It did not miss, so it is kept unchanged. One hit after
five misses is not calibration; it is one hit.

## 5. Explicitly NOT in this change

- **`node:https`**, and any TLS machinery, per Section 3. It remains exercised
  by nothing, which is a **known gap being carried deliberately for a second
  release** and should be stated in the release notes rather than omitted.
- **Response-handling limits.** Settled in `SPEC.md`, unimplemented, 0.4.0.
- **`--as-curl`, and P9 with it.** Parked 2026-09-08, not ruled out, with a
  revisit trigger in `decisions.md`. **P9 is retired as a tracked condition** —
  it travels with the feature, so it is work with no subject rather than unmet
  work, and it returns automatically if the feature does.
- **P6 — punycode host in `Host`.** Still NOT REACHED and NOT retired. Unlike
  P9 it has a subject and lacks only a test environment that is not
  `127.0.0.1`. It stays open against the rig.
- **The UI mutation gap** — the component's wiring to its extracted decisions,
  which needs a browser. Unchanged.
- **The landing page.** Ruled to follow 0.3.0.

## 6. What would stop this release

- **P-WIRE fails on the corpus and the cause is in the core rather than the
  adapter.** That would mean the exact request built by 0.2.0 is not the request
  that goes out, which falsifies the boundary release's central claim rather
  than this one's. **Record it and stop.** It is the outcome that matters most,
  and it is the reason the rig is fixed before any product code.
- **`node:http` cannot express the ordered array** (T2 falsified). Then the
  adapter has to write header bytes directly, which is a different and larger
  piece of work — re-scope rather than absorb it.
- **The work exceeds roughly two weeks.** Cut scope, do not re-estimate. Cut
  exit-code documentation before cutting a verification row; the rig fix and
  P-WIRE are the release.
