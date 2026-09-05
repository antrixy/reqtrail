# Leak audit — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`LEAK-AUDIT-PREREGISTRATION.md` before either instrument was written.

**No fix was made in this sitting**, as pre-registered. The instrument was built
first so the intervention has a before and an after.

---

## Result

    refuse() call sites in src/core            31
    sites interpolating a value not authored   20
    sites that can carry an environment value   2
    sites that can carry file content          16

    fixtures                                   24
    fixtures that leak                         12
      secret disclosure                         3 shapes, 2 call sites, 4 channels each
      terminal escape                           9 paths
    DOM channel                                NOT REACHED

`test/leak-audit.mjs` exits 1 while any path leaks. It is expected to fail today;
**the failure is the measurement.** After the fix it becomes a regression test.

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| C1 | 14 sites interpolate an unauthored value (±2) | **WRONG** — 20 |
| C2 | Exactly 2 sites can carry an environment value; no third | **right** |
| C3 | At least 8 sites can carry file content | **right** — 16 |
| C4 | The harness finds at least one instance nobody had found | **right** — seven |
| C5 | The API leaks on the same paths as the CLI | **right**, for the secret class |
| C6 | The DOM returns NOT REACHED on every refusal | **right** |
| C7 | No success or warning path leaks a secret — the defect is confined to refusals | **half wrong** — see below |
| C8 | At least two of C1–C7 wrong | **right** — two |

### C7 is the one to read

Its first clause held: no success or warning path discloses a secret. Its second
clause — *the defect is confined to refusals* — is false. A workspace whose
header value contains an ANSI escape puts that escape on the terminal through the
**ordinary success path**, with nothing refused and nothing warned.

The clause was written as a summary of the first clause, which is how an
unexamined assumption gets into a prediction wearing a measurement's clothes.
Two defects were being predicted as one.

### C1 was wrong by six, and the first answer was wrong by nine

The enumerator's first version took a five-line window from each `refuse(` and
reported 23. That window ran past the end of short calls and credited
`grammar.unmatched` with a `${ref}` belonging to the **next** call site. Rewritten
to balance parentheses: 20.

**Both figures were produced before the harness ran**, so the harness is what
caught it — a call site the enumeration said interpolated a value produced no
leak, and the discrepancy was the tell. Neither instrument alone was right.

## What was found

### Secret disclosure — 2 call sites, 3 shapes

| Shape | Refusal | Output |
| --- | --- | --- |
| `https://{{$env.T}}/`, T = `bad host SECRET` | `url.invalid` | the whole materialised URL |
| `{{$env.T}}`, T = `/relative/SECRET` | `url.invalid` | the whole value |
| `{{$env.T}}://a`, T = `schemeSECRET` | `url.scheme` | the scheme, lowercased |

All three reach **four channels**: the core's thrown detail, CLI human output,
CLI `--json`, and the loopback API response. The API case means the secret
**crosses the loopback boundary in plaintext**, which is a named UI security row,
not only a P4 failure. The token and Origin checks stop a web page reading it, so
this is disclosure to the local terminal and UI rather than exfiltration. That
bounds the severity; it does not repair the guarantee.

**Root cause, and it is not an oversight.** `decisions.md` requires structural
redaction — no plaintext materialised on the display side, only the transport
resolving it. `url.js` must materialise, because normalisation has to see real
bytes to report that a secret was re-encoded. That exception is real and was
understood: the module header says plaintext never leaves it. Then `parse()`
interpolates the materialised string into a refusal and it leaves.

Meanwhile `prepare.js` line 9 says *no code path produces a resolved secret value
at all*, and the README says the secret is *never materialised into anything
reqtrail displays, generates or logs*. **Two artifacts of my own, neither citing
the other, describing incompatible designs — the pattern this project has
recorded three times.** The leak lives exactly in the gap between them.

### Terminal escape — 9 paths

Eight refusals and one success path put raw control characters on the terminal
from workspace-file content: `schema.unknown-key`, `schema.id.charset`,
`schema.id.duplicate`, `schema.header.name`, `schema.type` (via a variable name
in the field path), `selection.unknown`, `grammar.charset`,
`grammar.whitespace`, and the rendered header value.

The external review found the header value and filed it under header validation.
**It is not a header problem.** It is the same defect as the secret leak on a
different channel: a value from outside is baked into prose, and by the time a
renderer sees it there is nothing left to say it needs escaping.

Field paths are a channel too. `variables.<hostile>` and `requests[0].headers[0]`
are built from file content and printed.

### Two paths are safe by accident, and that is the fix

`schema.version.unknown` and `schema.method` came back clean. Both quote with
`JSON.stringify()`, which renders an escape as the six literal characters
`\u001b`. Nobody chose that as a mitigation; it is a quoting habit that happens
to be correct.

The URL success path is clean for the same kind of reason: normalisation
percent-encodes an escape before it is displayed.

**Three call sites are already doing the right thing for no stated reason, and
sixteen are not.** That is the shape of a missing shared helper, not of sixteen
separate bugs.

## What this changes about the fix

The minimal repair proposed before this audit — pass a masked string into
`parse()` — would have closed one of twenty sites and been recorded as closing
the class.

`decisions.md` already says *errors are data, not prose: field path, cause and
code returned by the core and rendered by adapters.* But `cause` **is** prose
with values concatenated into it, so the adapter receives a finished sentence and
cannot mask or escape anything. The declared boundary exists in the code's shape
and not in its content.

The fix that matches the boundary already declared:

- a refusal carries its interpolated values as **named fields**, not baked in;
- one quoting helper renders a value at every site, escaping control characters
  the way `JSON.stringify` accidentally already does at two of them;
- secret-derived values are never handed to a message at all — the URL path
  passes the masked form, which it can already build without parsing.

That is one change closing both classes, and it moves toward the stated
architecture rather than bolting a guard onto `url.js`.

## Instrument defects found and corrected before any number was trusted

1. **The enumerator's line window** over-attributed expressions across call
   boundaries. First figure 23, corrected 20.
2. **The `schema.id.duplicate` fixture carried no marker.** It reported clean
   while testing nothing. A fixture that cannot exhibit the defect is not a clean
   result, and it was one of twenty-four.
3. **The first ad-hoc sweep, before this file existed, used a case-sensitive
   match** and reported `url.scheme` clean, because `new URL()` lowercases a
   scheme. The harness normalises case and percent-encoding for that reason.

Three instrument defects in one sitting, each of which would have produced a
falsely reassuring number. The lesson is the one slice 0 recorded and this
project keeps re-learning from a new direction: **check every component that
touches the artifact, including the one doing the checking.**

## Not reached

- **The DOM.** The UI renders a blank page on any refusal, so there is nothing to
  inspect. Recorded as NOT REACHED rather than clean; it must be re-run once the
  UI refusal contract exists.
- **`run` and the transport.** No transport exists in 0.1.0. Every path a
  response could open is untested by construction.
- **Whether 20 is the whole surface.** The enumeration covers `src/core`. The
  server and CLI adapters compose their own strings and were not enumerated.
