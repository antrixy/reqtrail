# Leak audit — pre-registration

**Written before the enumeration script or the harness existed, and before
either was run.** Section 3 is frozen.

## 1. Why this exists as its own sitting

An external review found one secret-disclosing refusal path. Verifying it turned
up a second that the review missed, and a probe of the refusal path turned up a
third defect — hostile file content reaching the terminal through refusal
messages — that the review had filed under a different heading.

Three findings, one class:

> **A value that came from the workspace file or the environment is concatenated
> into a refusal message as prose. By the time any renderer sees it, it is an
> ordinary string with no record of where it came from.**

Patching the reported instances would close the instances and leave the class.
So the instrument comes first, per the rule earned in toon-diff v0.4: **build
the instrument before the intervention**, as a separate change carrying no
version bump, so the fix has a before and an after rather than an argument.

**The cost is named rather than hidden.** A known secret disclosure stays
unfixed while this runs. Accepted deliberately: it needs a hostile or malformed
workspace to trigger, nothing is published, and the repository has one user.

## 2. What is being built

- **An enumeration.** Every `refuse()` call site in `src/core/`, classified by
  what its message interpolates and where that value can originate: a literal
  written by the author, workspace-file content, or an environment value.
  31 sites, counted before this file was written.
- **A harness.** Marked values driven through every reachable refusal code and
  every channel — the core's thrown detail, CLI human output, CLI `--json`, the
  loopback API response, and the DOM — checked for two things: the secret marker
  and raw terminal control characters.

**The matcher normalises case and percent-encoding.** A literal `includes()`
already produced one false negative today: `new URL()` lowercases a scheme, so a
secret that reached output via `url.scheme` was reported clean. The harness must
not be able to make that mistake.

## 3. PRE-REGISTERED PREDICTIONS — frozen

| # | Prediction | Confidence | Falsified by |
| --- | --- | --- | --- |
| C1 | Of 31 call sites, **14** interpolate a value the author did not write (±2) | medium | outside 12–16 |
| C2 | Exactly **2** call sites can carry an ENVIRONMENT value — `url.invalid` and `url.scheme` — and the audit finds no third | medium-high | a third is found |
| C3 | At least **8** call sites can carry workspace-file content into a message | medium | fewer than 8 |
| C4 | The harness finds **at least one instance neither the review nor I have found so far** | medium | it finds none |
| C5 | The loopback API leaks on exactly the same paths as the CLI — no more, no fewer | high | they differ |
| C6 | The DOM channel returns **NOT REACHED** for every refusal, because the UI renders a blank page on any refusal | high | anything renders |
| C7 | No success-path or warning-path output leaks a secret — the defect is confined to refusals | medium-high | a success path leaks |
| C8 | At least two of C1–C7 will be wrong | medium | fewer than two |

### On C2

This is the prediction I most expect to be wrong and the reason the audit is
worth its cost. Environment values enter the core through exactly one function,
so two sites is the answer that follows from reading the code — and reading the
code is what produced the belief that no path leaked at all.

### On C8

Every prediction here concerns code the predictor wrote last week. The sitting-A
profile — nine of ten right — is what that looks like when the predictions are
about one's own recent work, and it is not evidence of good predictions. If all
seven come back right, suspect the harness before believing the result.

## 4. Recording

    Date / Node version
    C1-C7: right / wrong / not reached, with the observed figure
    C8:    how many were wrong
    Every instance found, whether or not it was predicted
    Anything the enumeration found that the harness could not reach, named as
    NOT REACHED rather than counted as clean

No fix is made in this sitting. Wrong predictions keep their original wording.
