# Testable UI decisions — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`UI-LOGIC-PREREGISTRATION.md`. Baseline `45e7f4d`.

    ui suite    16 -> 26 checks
    mutants     57 -> 58, uncovered 4 -> 2, 224s
    sitting     14/16, F7 no longer NOT REACHED
    suite       green

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| L1 | All three `uncovered` UI mutants become killable | **right**, with a residue |
| L2 | F7 becomes measured, and the race is real | **right** |
| L3 | Sitting B's predictions hold unchanged | **right** — 14/16, as before |
| L4 | At least one decision does not extract cleanly | **right** — two |
| L5 | At least two of L1–L4 wrong | **WRONG** — none was |

## L2: F7 is answered, and the race is real

Sitting B recorded F7 as **NOT REACHED**: a browser driving the real server
cannot control response arrival order, so the race could not be provoked and the
guard could not be shown to be necessary. The guard shipped anyway, correct but
unjustified.

With the decision in `src/ui/logic.js`, out-of-order application is three lines:

    const first  = seq.begin();          // user selects A
    const second = seq.begin();          // user selects B before A returns
    seq.mayApply(first)   -> false       // A's response arrives late, refused
    seq.mayApply(second)  -> true        // B's response applies

and the companion check shows the naive version displaying **A** — the abandoned
selection — because whatever arrives last wins. The race is real.

The sitting now records F7 as **answered elsewhere**, naming where, rather than
having the question quietly deleted from its own record.

## L1 was right, and moved the gap rather than closing it

The three mutants — refusal classified as a result, unknown `--request` falling
back, sequence guard removed — are retargeted at the extracted functions and all
three die. `uncovered` drops from four to two.

**But a new `uncovered` mutant replaced them**: *the component ignores the
sequencer's verdict*. The decisions are now testable; the **wiring** between the
component and the decisions is not, and still needs a browser.

That is the honest shape of this change. It did not make the UI testable — it
moved the untested surface from "what the UI decides" to "whether the UI asks",
which is a much smaller and much duller surface, and a considerably better place
for a gap to live. Saying it closed the gap would be false.

## L4 was right: two judgements, not none

- **The sequencer is stateful by nature.** A pure function cannot express "the
  last selection wins" without the caller holding the counter, which just moves
  the untestable part back into the component. It is a factory returning
  closures — a judgement, and the reason is at the definition.
- **`classifyResponse` needed a third answer that did not exist before.** The
  component previously did `if (r && r.error) ... else setResult(r)`, so an
  unreadable body became `setResult(null)` and the next render read
  `null.prepared` — the blank page again, by another route. Extraction forced
  the case into the open: `unusable` is now a kind, and the component reports it.

**That is a defect found by extraction rather than by a test.** It needed a
malformed 200 from the local server to trigger, which nothing produces today.

## What changed

`src/ui/logic.js` — no React import — owns which request to select, what a 200
response means, and which of several in-flight responses may be applied. The
component calls them.

This is the core/adapter argument one level down: an adapter should own
rendering, and a decision the CLI would have to make identically does not belong
inside a component where only a browser can reach it.

## Still open

- **The component's wiring to the decisions** is `uncovered`, by construction.
- One mutant remains `uncovered` for continued consumption after a refusal:
  nothing in the suite can observe a socket still being read after a 413.
- `EVIDENCE-0.1.0.md` is now well behind the code — it reports 129 checks against
  a suite that runs 155, plus the whole leak, alignment and strict-JSON arc. It
  should be regenerated from a real run before anything is tagged, not edited.
