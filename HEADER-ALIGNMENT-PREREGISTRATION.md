# Header values aligned to node:http — pre-registration

**Written before the change and before it was run.** Section 3 is frozen.
Baseline `2dd38da`.

## 1. Established by measurement, before predicting anything

Node's `validateHeaderValue`, exhaustively over `U+0000`–`U+10FF` plus samples
above:

    accepted:  U+0009 (tab), U+0020-U+007E, U+0080-U+00FF
    rejected:  every other C0 (including CR, LF, NUL), U+007F (DEL),
               and everything from U+0100 up — so all emoji

reqtrail currently refuses only CR, LF and NUL, so `\u001b`, DEL, vertical tab
and emoji are reported **resolvable** and would be rejected by the transport.

Two further measurements that shape the design:

- **`U+0080`–`U+00FF` is accepted and transmitted as a single Latin-1 byte.**
  Measured on a raw socket: `café` leaves as `63 61 66 e9`, not UTF-8. A file
  authored in UTF-8 sends something its author did not intend, and the receiver
  usually sees an invalid sequence. That is a display-versus-sent gap of exactly
  the kind this product exists to surface — so it warrants a **warning, not a
  refusal**, consistent with "flag, do not forbid".
- **Header NAMES already agree exactly.** Ten shapes tested against
  `validateHeaderName` and reqtrail's token rule: identical verdicts. Nothing to
  change, and the measurement is recorded so nobody re-derives it.

## 2. The decision, and its cost stated plainly

Aligning means refusing values on the strength of a transport this release does
not have. That is the shape of claim we spent three sittings removing, so it is
made deliberately rather than by drift:

**The rule ships now, and the reason given is the FILE FORMAT, not the
transport.** A workspace that cannot be sent is a workspace reqtrail should
refuse to call sendable, and the alternative — accept now, refuse when `run`
lands — breaks files that worked, which the version field exists to prevent and
which relaxing-later does not.

Note the residue this leaves, which will be documented rather than reconciled:
**C1 controls (`U+0080`–`U+009F`) are accepted**, because node accepts them,
while the CLI *escapes* them on display. Accepting a byte and escaping its
rendering are different things, and both are correct.

## 3. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| K1 | After the change, all four review examples refuse — ESC, DEL, vertical tab, emoji | high | any resolves |
| K2 | No existing check or fixture breaks | medium | any breaks |
| K3 | No existing mutant changes outcome; the new rule needs new mutants of its own | medium | an existing one moves |
| K4 | The Latin-1 warning fires for `café` and for nothing currently in the repository | medium-high | it fires on an existing fixture |
| K5 | The refusal-site count rises to **37**, all still carrying literal messages | medium | a different number |
| K6 | At least two of K1–K5 wrong | medium | fewer than two |

## 4. Recording

    K1-K5: right / wrong, with figures
    K6:    how many wrong
    The C1 residue, stated either way
