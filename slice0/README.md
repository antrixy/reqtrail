# slice0 — frozen falsifier harness

**This is not product code, and `prepare.mjs` in particular is not an early
version of reqtrail.** It is the crudest thing that could produce a request to
send and a view to display, so that the two could be compared. It implements
only what the comparison needed.

**Frozen 2026-09-04.** Results are recorded in `../SLICE-0-EVIDENCE.md` against
predictions frozen in `../SLICE-0-PREREGISTRATION.md`. Editing these files
invalidates that evidence — the same rule as `antrixy/import-fidelity-spike`.

## Why it is kept at all

The run's headline finding is that **`fetch` cannot express reqtrail's canonical
header model** — it collapses duplicate header names and injects four headers
the user never wrote — while `node:http` can. An evidence file asserting that is
a claim. **A harness that demonstrates it is proof**, and that distinction is
what this project is about.

It also nearly produced a FALSE finding, and reproducing that matters more than
reproducing the correct one. See the evidence file.

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
    probe-dup.mjs     the disambiguation probe. Distinguishes "the transport
                      cannot" from "this harness cannot". The reason a false
                      finding was not recorded.

## Running it

    node run.mjs           expect P4 and P8 to FAIL
    node adversarial.mjs   expect 9 sent all matching, 7 refused, 0 bytes leaked
    node probe-dup.mjs     expect 2 X-Tag occurrences, 2 runtime-added headers

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
