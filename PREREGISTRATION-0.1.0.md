# 0.1.0 — pre-registration

**Written before any 0.1.0 code was written and before anything was run.**
Section 2 is frozen. Record results beside each prediction; do not edit the
wording of a prediction to match an outcome.

Slice 0 already measured transport and URL behaviour, and those measurements are
not re-predicted here. What follows is only what 0.1.0 introduces and nobody has
measured: the display path for an **unresolved** reference, the `node:http`
protection rows, the CLI/server parity comparison, and the esbuild bundle.

---

## 1. Scope of this run

Selftest suite, parity test, and the server security rows. No browser sitting —
the UI security rows are asserted against the server over loopback, not through
Chrome. A browser pass is a separate sitting and is not claimed by this file.

## 2. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| P1 | `new URL()` accepts a literal `{{host}}` in the host position, so "does it parse" cannot be used to detect an unresolved reference | high | it throws |
| P2 | `{{` and `}}` are percent-encoded in a path and pass through unchanged in a query | high | any difference |
| P3 | Two header entries with identical name **and** identical value survive as two entries through prepare and both appear in `--json` | high | they collapse |
| P4 | For a resolved secret of ≥8 characters, no reqtrail-generated output contains it as a substring — human render, `--json`, warnings, errors | high | it appears anywhere |
| P5 | A workspace whose only fault is an unset env var exits 1 **and** still prints a parseable JSON payload on stdout under `--json` | medium | stdout is empty or unparseable |
| P6 | `node:http`'s default `requestTimeout` (300s) and `headersTimeout` (60s) are too permissive for rows 3 and 4, so a partial header block is closed by our configuration and not by the default | medium-high | defaults already close within our budget |
| P7 | `maxHeaderSize` rejects an oversized header block before any handler runs, with a status rather than a bare socket reset | medium | the handler sees the request, or the socket resets with no status |
| P8 | A request carrying a foreign `Host` header still reaches our handler — `node:http` does not validate it — so the rebinding defence must be ours | high | node rejects it first |
| P9 | `Origin` is absent on a top-level navigation to `GET /` and present on a `fetch` from the page | high | either is otherwise |
| P10 | **The first parity run fails** on at least one field, because one adapter will have introduced something the other did not — key order, a version string, or number formatting | medium-high | it passes first time |
| P11 | The esbuild bundle contains no occurrence of `dangerouslySetInnerHTML` | medium | it appears — in which case **the bundle grep is void as a check** and only the source check is valid |
| P12 | At least two of P1–P11 will be wrong | medium | fewer than two |

### Why P11 is written this way

`dangerouslySetInnerHTML` is prohibited **and the prohibition is tested**. There
are two candidate checks — grep the source, grep the bundle — and the second is
the stronger one only if react-dom's own minified source does not carry the
string. If it does, a bundle grep can never pass and would be quietly dropped,
leaving the prohibition untested while looking tested. P11 decides which check
is real before either is written.

### Why P10 is written this way

A parity test that passes on its first run has usually been written after the
two sides were already made to agree, which is the retrofit the handoff warns
about. Predicting failure first is how this one earns its place.

## 3. Recording

    Date / Node version / OS
    P1-P11: right / wrong / not reached, each with the observed output
    P12:    how many of P1-P11 were wrong
    Selftest: n/n
    Parity:  pass/fail, and what the first run disagreed on

A wrong prediction is a result. Keep the original wording.
