# Strict JSON and names — pre-registration

**Written before the change and before it was run.** Section 4 is frozen.
Baseline `981e9d0`.

## 1. Three findings from the external review, measured

    duplicate "url" member   -> the SECOND value is used, silently
    variable named "a b"     -> accepted, and unreferenceable by the grammar
    "{\"a\":{\"b\":1}}" value -> accepted (a stray `}}` is literal text)

The first two are holes in a product whose subject is *there will be no
surprises about what gets sent*. `JSON.parse` is last-wins by specification, so
two workspaces that differ in an important way parse identically and nothing
says so — the same shape as the HeaderWright export where two configurations
serialized to identical bytes.

## 2. The third one is different, and the fix is probably the README

The README says unmatched braces are refused. A stray `}}` is not refused. The
obvious repair is to refuse it — and that looks wrong before writing a line,
because `decisions.md` already rejected an escape mechanism partly on the
grounds that **values in this tool routinely contain JSON fragments, Windows
paths and regex**. `{"a":{"b":1}}` in a header value ends in `}}` and is
perfectly legitimate.

`{{` is asymmetric with `}}` for a reason: `{{` opens a template and there is
nothing else it can mean; `}}` is ordinary text unless something opened. If that
holds, the defect is the README's wording, not the parser, and the fix is one
sentence.

## 3. Scope

A duplicate-member detector, a charset check on `variables` keys, and whichever
resolution the `}}` question deserves. No change to substitution or normalization.

## 4. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| J1 | My first duplicate detector **misses at least one nesting case** — objects inside arrays, or keys shadowed at different depths | medium-high | it handles every case first time |
| J2 | Refusing a stray `}}` would refuse a legitimate value, so the README is what changes | medium-high | no legitimate shape is affected |
| J3 | The charset check on `variables` keys breaks no existing check or fixture | high | any breaks |
| J4 | Duplicate detection costs **under 80 lines** | medium | more |
| J5 | No existing check breaks from duplicate detection | medium | any breaks |
| J6 | At least two of J1–J5 wrong | medium | fewer than two |

### On J1

A duplicate-key scanner is a small parser, and small parsers are where "it
works on my example" lives. Predicting the miss in advance means the nesting
fixtures get written before the implementation is trusted, rather than after it
passes.

## 5. Recording

    J1-J5: right / wrong, with what was observed
    J6:    how many wrong
    Every nesting case the first implementation got wrong, by name
