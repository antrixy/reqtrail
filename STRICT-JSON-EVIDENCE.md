# Strict JSON and names — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`STRICT-JSON-PREREGISTRATION.md`. Baseline `981e9d0`.

    selftest   135 -> 147
    refusals    33 -> 35 call sites, all literal
    mutants     48 -> 53, 248s
    suite       green

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| J1 | The first duplicate detector misses at least one nesting case | **WRONG** — see below |
| J2 | Refusing a stray `}}` would refuse a legitimate value, so the README changes | **right** |
| J3 | The variable charset check breaks no existing check | **right** |
| J4 | Duplicate detection costs under 80 lines | **right** — 62 |
| J5 | No existing check breaks | **right** |
| J6 | At least two of J1–J5 wrong | **WRONG** — one was |

## J1 was wrong, and a neighbouring defect was there instead

Nine nesting fixtures were written before the implementation was trusted, which
is what the prediction was for. **Detection was correct in all nine on the first
run** — root, array element, second array element, nested object, deep in
headers, the same key at different depths (correctly clean), a brace inside a
string value, an escaped quote inside a key, and a clean file.

But the **field path was wrong for every array case**: `requests.url` where it
should read `requests[0].url`, and `requests.headers.value` for
`requests[0].headers[1].value`. Field paths are part of the error contract —
`decisions.md` says errors name field path and cause — so a path that cannot
tell you *which* request is a defect, not a cosmetic issue.

The prediction was aimed at the detector and the defect was in the path. Written
as "misses a nesting case", it is wrong; the fixtures it caused to be written
are what found the real thing. Recorded as wrong.

Three mutants now cover the distinction: dropping the index from the path,
failing to track array position, and disabling the scanner outright.

## J2 was right, and the README was the defect

The review found that a stray `}}` is accepted while the README says unmatched
braces are refused. The obvious repair is to refuse it. Measured against the
value shapes `decisions.md` named when it rejected an escape mechanism:

    {"a":{"b":1}}                  in a header value  -> would be refused
    filter={"x":{"y":2}}           in a query         -> would be refused
    ^a{2}{3}$                      regex              -> unaffected

`{{` and `}}` are asymmetric for a reason: `{{` can only open a template, while
`}}` closes any nested JSON object, and values in this tool routinely contain
JSON fragments. **Refusing it would cost more than the symmetry is worth.**

So the README changed, and it now says so explicitly rather than leaving a
reader to infer the rule from an omission. An unclosed `{{` is still refused.

## What changed

- **Duplicate object members are refused**, at any depth, with the full field
  path including array indices. `JSON.parse` is last-wins by specification, so
  `{"url":"a","url":"b"}` silently became `"b"` — two files that behave
  differently parsing identically, which is the same failure that made
  first-wins wrong for duplicate request ids.
- **A variable name outside the reference charset is refused.** `{"a b": "x"}`
  was accepted and could never be named by any `{{...}}`. The check uses the
  grammar's own charset, kept beside the id rule so a change to one is visibly
  a change to the other.
- **The README's brace rule is corrected**, and the duplicate-key rule added to
  the list of what is refused.

## Still open

- Header validation is narrower than `node:http`. **This is the last review item
  and it needs a decision, not a fix**: aligning means refusing values on the
  strength of a transport this release does not have.
- Three UI-behaviour mutants remain `uncovered`.
- One mutant remains `uncovered` for continued consumption after a refusal.
