# Leak fix — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`LEAK-FIX-PREREGISTRATION.md` before any of the fix was written. Baseline is
commit `7ab1f60`, where the audit reported 12 of 24 fixtures leaking.

## Result

    before                                    after
    secret disclosure   3 shapes              0
    terminal escape     9 paths               0
    fixtures leaking    12 of 24              0 of 26
    refuse() sites      31, 20 interpolating  33, 0 interpolating
    mutation            22, 1 equivalent      28, 1 equivalent

`node test/leak-audit.mjs` exits 0 and is now part of `npm test`, together with
`test/enumerate-refusals.mjs`, which fails the suite if any refusal
interpolates a value into its message.

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| D1 | All 3 secret paths close | **right** |
| D2 | All 9 escape paths close | **right** |
| D3 | At least one call site needs a judgement, not a mechanism | **right** — three |
| D4 | The check catches at least one call site I miss on the first pass | **WRONG** |
| D5 | At least 3 selftest checks break on message text | **WRONG** — none did |
| D6 | Parity stays byte-identical, untouched | **right** |
| D7 | At least one new mutant survives | **right** — two, both real |
| D8 | At least two of D1–D7 wrong | **right** — two |

### D4 was wrong, and the check still had to prove it could fail

All 33 call sites came back literal on the first run. That is a green result
from a check that had never failed, which is the thing this project does not
accept, so an interpolation was planted: `refusals 32/33`, exit 1, naming the
file and line. **The check can fail; it simply had nothing to find.**

Two call sites were added by the fix — `url.scheme` and `header.control` each
split in two — which is why the count went from 31 to 33.

### D5 was wrong for a reason worth knowing

Not one selftest check broke. The suite asserts `code` and `path`, and the two
checks that do read `cause` use `includes` on a substring that survived
requoting. **That is luck, not design.** 133 checks passed while every refusal
message in the program was rewritten, which means the suite barely constrains
message text at all. Recorded as a gap rather than as a pass.

### D3 — the three judgements

- **`schema.json`** carries `e.message` from `JSON.parse`. It is the runtime's
  description of the file, not a field of it, so it is escaped but **not
  quoted**: quoting would read as though the file contained that sentence.
- **`grammar.charset`** has a literal `$env.` in its message, which the slot
  syntax `$name` would eat. It is supplied as a value named `env` and rendered
  back. The alternative — a second escaping convention for templates — buys a
  new way to be wrong.
- **`url.scheme`** needed two templates, one naming the scheme and one saying it
  is withheld, because whether the scheme is safe to print is a property of the
  input rather than of the call site.

### D7 — two survivors, and both were real

**1. No fixture reached DEL or C1.** Deleting the `\u007f-\u009f` half of the
escape pattern survived everything. The audit's hostile marker used ESC only,
so the half of the helper that exists *because `JSON.stringify` does not cover
those ranges* was untested. Two fixtures added; the mutant now dies.

**2. The scheme guard was over-conservative, and mutation is what said so.**
The first version refused to name the scheme whenever the URL contained a mask
**anywhere**. A literal `ftp://` with a secret in the query is perfectly safe to
name, and withholding it costs the diagnosis for nothing. Replaced by deriving
the scheme from the masked string alone, which is safe by construction: if any
part of the scheme came from a secret, the mask leaves a `•` in the scheme
position and the masked string does not parse at all.

The mutant was also badly aimed — it sat inside a `try` after the line that
throws, so it could not execute. Retargeted at the real property: when the
masked string cannot be parsed, the scheme must not be recovered from the raw
one. It dies now.

## What the fix is

`decisions.md` already said *errors are data, not prose: field path, cause and
code returned by the core and rendered by adapters.* `cause` **was** prose with
values concatenated in, so an adapter received a finished sentence and could
mask or escape nothing. The declared boundary existed in the code's shape and
not in its content.

- `refuse()` takes a **template and a values object**. The template is a literal
  with `$name` slots and no interpolation, so a call site has no string to bake
  a value into.
- Values are escaped and quoted **once**, in `errors.js`, where the Refusal is
  built — not at call sites. `decisions.md` forbids call-site masking, and a
  helper you must remember to call is a habit rather than a mechanism.
  `detail.values` holds the escaped forms, because adapters serialize `detail`
  and a raw values map would put the leak straight back through `--json`.
- `url.js` passes the **masked** URL, which it can build without parsing.
- `src/cli/render.js` escapes control characters in everything it prints, not
  only refusals — the audit found a success path putting an escape on the
  terminal with nothing refused.
- The prohibition is **machine-checked** by `test/enumerate-refusals.mjs`.

Diagnosis survives, which was the thing at risk:

    reqtrail: url: "https://••••/" is not a valid absolute URL [url.invalid]
    reqtrail: url: scheme "ftp" is not http or https [url.scheme]
    reqtrail: requests[0].id: "r\u001b[31mBAD\u001b[0m" is not a valid request id

## Corrections made to committed artifacts

Three statements were false and are corrected rather than quietly dropped:

- **`src/core/prepare.js`** said *no code path produces a resolved secret value
  at all.* False. `url.js` must materialise. The comment now says where the one
  place is and what it guarantees.
- **`README.md`** said no code path resolves a secret. Same correction, and it
  names the audit.
- **`EVIDENCE-0.1.0.md`** carries a dated correction block: **P4 is falsified**,
  and its counts were stale at 129 against a suite that runs 133. The original
  wording is left in place.

## Not fixed here, and named so the omission is a decision

- **Header validation is still narrower than `node:http`.** `\u001b`, DEL, C1
  and emoji are accepted by reqtrail and rejected by the transport. Aligning
  them changes what reqtrail refuses on the strength of a transport this release
  does not have. Separate sitting.
- **The UI still renders a blank page on any refusal**, so the DOM channel
  remains NOT REACHED. Until that is fixed, no measurement of the browser's
  output on a refusal exists — and the audit says so rather than reporting clean.
- **The adapters were never enumerated.** `src/cli/render.js` composes nine
  strings of its own; they are now escaped, but no check enforces it the way
  `enumerate-refusals.mjs` enforces the core.
- **The selftest barely constrains message text**, per D5.
