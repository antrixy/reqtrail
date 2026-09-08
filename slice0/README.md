# slice0 — frozen falsifier harness

**This is not product code, and `prepare.mjs` in particular is not an early
version of reqtrail.** It is the crudest thing that could produce a request to
send and a view to display, so that the two could be compared. It implements
only what the comparison needed.

**Frozen 2026-09-04. ONE REPAIR SINCE, on 2026-09-08:** `run.mjs`'s send side
built an object from the ordered header array and has been changed to pass a
flat array. Results are recorded in `../SLICE-0-EVIDENCE.md` against predictions
frozen in `../SLICE-0-PREREGISTRATION.md`.

**The repair was allowed because no verdict moved.** P4 and P8 were falsified on
09-04 and are still falsified, no assertion was edited, and the one observed
detail that changed is corrected in the evidence rather than left standing. Had
a prediction flipped, this would have been the study rather than a repair, and
the answer would have been a separate live harness. **The bar for the next edit
is that same one**, not tidiness: `antrixy/import-fidelity-spike`'s rule is that
a frozen artifact must stay frozen and must not stay wrong about itself.

## Why it is kept at all

The run's headline finding is that **`fetch` cannot express reqtrail's canonical
header model** — it collapses duplicate header names and injects four headers
the user never wrote — while `node:http` can. An evidence file asserting that is
a claim. **A harness that demonstrates it is proof**, and that distinction is
what this project is about.

**Credit where it is due, corrected 2026-09-08.** On 09-04 that demonstration
was `probe-dup.mjs`, not `run.mjs` — `run.mjs` collapsed the ordered array into
an object before `node:http` saw it, so it showed what `node:http` can do only
for the one fixture shape an object survives. Since the send-side repair
`run.mjs` demonstrates it too.

It also nearly produced a FALSE finding, and reproducing that matters more than
reproducing the correct one. **It then produced a second instance of the same
failure, in this file, and did not catch it for four days.** See the evidence
file.

## Files

    receiver.mjs      raw-socket capture. NOT http.createServer — a parsed
                      server normalizes the request line and header block
                      before you see it, which would make the harness measure
                      itself.
    prepare.mjs       minimal prepared-request builder. Secrets stay as
                      segment references until materialize(); render() masks.
                      If this flattened values to strings, P10 could not be
                      tested.
    run.mjs           base fixture, sends via node:http, evaluates P1-P14.
    adversarial.mjs   16 hostile inputs; 9 sent, 7 refused.
    probe-dup.mjs     the disambiguation probe for DUPLICATE NAMES.
                      Distinguishes "the transport cannot" from "this harness
                      cannot". The reason a false finding was not recorded.
    collapse-demo.mjs the same probe for the SEND SIDE, added 2026-09-08. One
                      ordered array sent both ways at one receiver: four
                      occurrences in, two out through the object form.

## Running it

    node run.mjs           expect P4 and P8 to FAIL
    node adversarial.mjs   expect 9 sent all matching, 7 refused, 0 bytes leaked
    node probe-dup.mjs     expect 2 X-Tag occurrences, 2 runtime-added headers
    node collapse-demo.mjs expect 4 sent, 2 captured under the collapse,
                           4 under the flat array

**`probe-dup.mjs` still reports two runtime-added headers and `run.mjs` now
reports one.** Not a contradiction: `probe-dup` passes an OBJECT deliberately,
because an object is what it was written to interrogate.

**P4 and P8 failing is the correct output.** They are falsified predictions and
the assertions still encode what was predicted, not what was observed.
**Do not "fix" them to pass** — editing an assertion to fit an outcome is the
failure this harness's own conduct note records.

## What is NOT here

**P9 — `--as-curl` parity — was never built**, and it is listed in the
pre-registration as step 6 of the run. It remains an open condition on the
claim, not an omission: the cURL renderer is a second producer of the view the
claim is about, and if it disagrees with the prepared request the claim has a
hole. This harness plus a renderer is the cheapest way to close it.

**P6 — punycode host — was not reachable** against `127.0.0.1`.

**That may have changed and is NOT claimed closed here.** Under the flat array
`node:http` supplies no `Host` at all, so a sender writes its own — and a `Host`
of one name went out over a socket connected to `127.0.0.1` in a probe on
2026-09-08. If reqtrail builds `Host`, punycode becomes a property of its own
derivation rather than something needing a non-loopback environment. One probe
is not a row. It stays NOT REACHED until something measures it.
