# Two fixes from the eleventh external input — evidence

**Run 2026-09-05, Node v22.22.2.** Predictions frozen in
`SECOND-CORRECTION-PREREGISTRATION.md`. Baseline `2f7e19a`.

    ui suite     26 -> 27 checks
    mutants      58 -> 60, 222s, all accounted for
    suite        green

## Predictions

| # | Prediction | Result |
| --- | --- | --- |
| M1 | A distinct startup-failure type fixes A, and no existing check breaks | **right** |
| M2 | No mutant or check covers the `ui.not-built` path | **right** — neither existed |
| M3 | A machine check can express "no secret in a public result" but not "only these modules read one" | **right** |
| M4 | All eight secret-reading sites are legitimate | **right** |
| M5 | At least one of M1–M4 wrong | **WRONG** — none was |

## A — `reqtrail ui` told the user reqtrail was broken

`loadAssets()` built a `Refusal` with the pre-template `cause` argument. The
errors rewrite made `template` mandatory, so it threw:

    reqtrail: internal error — this is a bug in reqtrail 0.1.0.
      Cannot read properties of undefined (reading 'replace')
    exit=0

**The user's file was fine and reqtrail said reqtrail was broken.** That is the
failure sitting B fixed for bad schemas, reintroduced one layer over by a
signature change made afterwards — and nothing caught it, because nothing looked.

**Fixed with a distinct type rather than a repaired call.** A missing bundle is
not a workspace refusal: a `Refusal` names a field path in the user's file, and
there is no field path to give. `StartupFailure` carries a code and a cause and
nothing else. **Exit 2, not 1** — nothing in the workspace is wrong, so *edit
something* is the wrong instruction.

    reqtrail: index.html is missing; run "npm run build:ui" before "reqtrail ui"
      in a source checkout (published packages ship it built) [ui.not-built]
    exit=2

Now checked: a source checkout is copied without `dist/`, the CLI runs, and the
check asserts exit 2, the code, the remedy, and **that the internal-error path is
not taken**. Two mutants aimed at it — reverting to a `Refusal`, and exiting 1 —
both die.

## B — the same sentence was wrong twice, and the second time was mine

    original:  no plaintext is materialised on the display side at all
    corrected: plaintext exists in exactly one place — src/core/url.js
    measured:  eight sites, three modules

      grammar.js   nested-template check, set-but-empty check
      prepare.js   probe(), the control-character scan, the charset scan
      url.js       normalization, span attribution

**A false absolute was replaced with a narrower false absolute, inside a
correction whose entire subject was that an unchecked absolute is what hid a
defect.** The grep that disproves it is one command and it was not run. This is
the SECOND-ASSUMPTION pattern held as a candidate in the toon-diff handoff — the
second assumption made while fixing the first goes unexamined because attention
is on the first — and **it now has a payout.**

**Why the leak audit stayed green through both wrong sentences**, which is the
part worth keeping: the audit checks *outputs*, and the outputs were correct
both times. It was never capable of falsifying either sentence, because neither
sentence was about outputs. **A green suite is not evidence for a claim the suite
does not test**, and the claim was architectural while every check was
behavioural.

**The replacement is stated as a property of the outputs**, which is what the
audit does test: secret bytes exist transiently inside the core's private
preparation, wherever a decision needs them, and never in a public result, a
rendered view, a refusal, a warning, a protocol response or a log.

M3 records why it is not stated as a module list: "only these modules may read
one" is checkable only by grepping for `env[`, which is a lexical instrument on a
structural property — the mention-versus-use failure this project has already
recorded four times. **Containment stated as a module list is what made the
sentence wrong twice.**

## M4 — all eight are legitimate, checked rather than tidied

The reflex on being told three modules read secrets is to consolidate. Each site
was examined instead:

| Site | Needs the value to |
|---|---|
| `grammar.js` nested check | know whether it contains a template |
| `grammar.js` empty check | distinguish unset from set-but-empty |
| `grammar.js` `plain()` | build the string `url.js` normalizes |
| `prepare.js` `probe()` | build the header scan input; differs from `plain()` on unresolved |
| `prepare.js` control culprit | name **which variable** carried the CR |
| `prepare.js` charset culprit | same, for the code-point rule |
| `url.js` probe build | substitute the sentinel for span attribution |
| `url.js` transformed flag | compare produced bytes against the substituted value |

**None is removable without losing a check or a field path.** Consolidating would
move the reads without reducing them, and would trade a named variable in a
refusal for tidiness.

## M5 was wrong: four for four

Fifth sitting running where the meta-prediction overestimated the error rate. The
mitigating evidence is thinner than usual here — this sitting fixed two defects
found by someone else, and predicting one's own repair accurately is a much
weaker result than predicting one's own code accurately.

## Not fixed here, deliberately

- **`startUi` reads `{ ...process.env }`** where `resolve` uses
  `io.env ?? process.env`. Real, one line, and the same ambient-state class as
  the first parity failure. Left out so this sitting fixes what it says.
- **The 0.2.0 boundary work** — the private exact request and public safe
  projection, the shared `inspect`/`run` use cases, the transport adapter taking
  a raw ordered header array. Its own sitting, its own pre-registration.
- **`prepared` is a masked view and cannot be sent.** True by design at 0.1.0
  and a trap for 0.2.0: adding `run` against an object named `prepared` invites
  the second construction path the claim forbids. Renaming belongs with the
  boundary work, not here.
