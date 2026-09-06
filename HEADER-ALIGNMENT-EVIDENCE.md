# Header values aligned to node:http — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`HEADER-ALIGNMENT-PREREGISTRATION.md`. Baseline `2dd38da`.

    selftest   147 -> 155      refusal sites  35 -> 37, all literal
    leak audit  26 -> 28 fixtures
    mutants     53 -> 57, 252s
    suite       green

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| K1 | ESC, DEL, vertical tab and emoji all refuse | **right** |
| K2 | No existing check breaks | **WRONG** |
| K3 | No existing mutant changes outcome | **WRONG** |
| K4 | The Latin-1 warning fires for `café` and nothing in the repository | **right** |
| K5 | The refusal-site count rises to 37, all literal | **right** |
| K6 | At least two of K1–K5 wrong | **right** — two |

## The rule, established by measurement

`validateHeaderValue`, exhaustively over `U+0000`–`U+10FF` plus samples above:

    accepted:  U+0009, U+0020-U+007E, U+0080-U+00FF
    rejected:  every other C0 including CR/LF/NUL, U+007F, and U+0100 upward

reqtrail refuses the same set. **CR, LF and NUL keep their own code**
(`header.control`): they are a header-injection attempt rather than a typo, and
the remedy differs. Everything else is `header.charset`, naming the code point
and the variable that carried it.

**Header names needed no change.** Ten shapes against `validateHeaderName` and
reqtrail's token rule: identical verdicts. Recorded so nobody re-derives it.

**The rule is stated as a property of the FORMAT, not the transport.** Aligning
means refusing values on the strength of a transport this release does not have,
which is the shape of claim three sittings were spent removing. It ships anyway
because the alternative — accept now, refuse when `run` lands — breaks files that
worked, and relaxing later breaks nothing while tightening later breaks
everything.

## K2 was wrong: the fourth mention-versus-use collision

`exit code 3 is unreachable — no transport exists` greps the core for
`/node:https?["']/`. A comment added by this change reads *"node:http's
validateHeaderValue"*, and **the apostrophe completed the pattern's quote**.

Fourth time on this project a pattern match has confused a mention with a use,
after `dangerouslySetInnerHTML`, the always-true guard, and the enumerator's line
window. Comments are now stripped before that grep, by a small stripper written
to be readable — a stripper that silently ate code would make the check pass for
the wrong reason. Demonstrated still able to fail by planting a real `fetch(`.

## K3 was wrong, and this is the finding of the sitting

The mutant *"rendered header values are not escaped"* had been killed since the
leak fix. After this change it **survived**.

Nothing about the renderer changed. What changed is that every hostile fixture in
the leak audit carried an ESC, and ESC is now refused at parse — so no fixture
reached the renderer any more, and the display-escaping had no test left.

**Tightening an input rule silently deleted coverage of an output rule.** The
escaping is still needed, and precisely for the residue named in the
pre-registration: `U+0080`–`U+009F` are C1 terminal controls, node accepts them,
so reqtrail accepts them — and they must still be escaped on the way out.

Two fixtures added carrying C1 alone, one literal and one through a variable.
The mutant dies again, reporting two escape paths.

Had K3 not been written down, the pass would have shown one survivor in a file
this change did not touch, and the likely reading would have been "unrelated,
look later".

## The residue, stated rather than reconciled

`U+0080`–`U+00FF` is **accepted, and warned about**. Measured on a raw socket:
`café` leaves as `63 61 66 e9` — one Latin-1 byte per character, not UTF-8. A
file authored in UTF-8 sends something its author did not intend and the
receiver usually sees an invalid sequence.

Refusing it would be reqtrail inventing policy where the transport has none;
saying nothing would be the display-versus-sent failure this product exists to
prevent. So: `header.latin1`, a warning, exit code unchanged.

C1 controls sit inside that accepted range. **Accepting a byte and escaping its
rendering are different things, and both are correct here** — the file may
contain it, the terminal must not be driven by it.

## Still open

- Three UI-behaviour mutants remain `uncovered`; the UI's behavioural
  correctness rests on a browser sitting run by hand.
- One mutant remains `uncovered` for continued consumption after a refusal.
- F7 (the stale-response race) is still NOT REACHED.

**Every item from the external review is now closed.**
