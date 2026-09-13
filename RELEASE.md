# Releasing reqtrail

**Every step here exists because it was missed once.** Nothing is defensive
habit; each line names the release it cost.

`test/selftest.mjs` enforces the parts a check can reach. The rest is a
checklist because it happens outside the repo — in GitHub's UI and on npm — and
**the steps outside the repo are the ones that have gone wrong.**

## Before

**1. Bump BOTH version strings.**

    package.json     "version"
    src/cli/main.js  VERSION

Two files hold one fact. **v0.2.0 shipped a crash message telling users to
report a bug in reqtrail 0.1.0** because only one was bumped. `:881` compares
`package.json` against what the real binary reports, and a second check pins
that `bin/reqtrail.js` interpolates `${VERSION}` rather than holding a literal.

**2. Write the release's evidence document** and re-point the drift guard in
`test/selftest.mjs` at it.

**3. Freeze the OUTGOING drift guard** at the count the previous release
shipped.

This has bitten three times — `EVIDENCE-0.1.0.md`, `BOUNDARY-EVIDENCE.md`,
`TRANSPORT-EVIDENCE.md`. **A drift guard aimed at a published document demands
that the document be edited to a count that release never had.** The guard is
right until the tag exists and wrong the instant after, so freezing it is a
release action, not a repair.

**4. `npm test` on a CLEAN checkout**, not on the machine you have been building
on. `prepack` runs it again during publish; both matter.

**5. Run the browser sitting.** `CHROMIUM_PATH=... node test/sitting-browser.mjs`.
`src/ui/main.jsx` is an uncovered mutation gap — `ui 27/27` says the bundle
builds and the extracted decisions are right; it does **not** say the component
renders. The sitting's `F3` prints the page text, and **that dump is what caught
`main.jsx` claiming the release could not send.**

**6. Grep the surfaces a check cannot read.** The selftest forbids `this
release`, `current release`, `arrives in N`, `ships in N` in `README.md`,
`src/ui/main.jsx` and `src/cli/main.js`. **It cannot see the GitHub About
sidebar**, which read *0.1.0 inspects only: there is no transport yet* while
`main` was 0.3.0 with a working transport. Check it by eye.

**7. Write the release notes FROM CAPTURED OUTPUT.** Run the command, paste what
it printed. The v0.3.0 notes were hand-written from memory and omitted the
entire `Substitutions` block. **In a tool whose claim is that what you see is
what happens, a hand-written sample is the wrong artifact.**

**8. Verify the notes' claims AGAINST THE TREE, not by re-reading them.** This
is how `run` on an `https://` URL was found exiting 3 — documented as *send
attempted and failed; nothing to edit; may be transient*, when nothing had been
attempted and the fix was one character in the user's file.

## Tagging

**9. Delete the TAG, not just the release, if one already exists.** Deleting a
release leaves its tag. Creating a release with an existing tag name **binds to
the existing tag and silently ignores the Target dropdown.** The delete lives on
the **Tags** tab and is greyed out while a release is attached.

**10. VERIFY THE TAG IS GONE BEFORE CREATING IT.** One fetch.

    curl -o /dev/null -w '%{http_code}\n' \
      "https://raw.githubusercontent.com/antrixy/reqtrail/vX.Y.Z/README.md"

`v0.3.0` was created, deleted and recreated **three times** and never moved off
the wrong commit. **A no-op delete and a successful one are indistinguishable
unless you look between them** — that is the whole reason this is its own step.

**11. Verify the tag resolves to the sha the suite was verified at.**

    curl -s "https://raw.githubusercontent.com/antrixy/reqtrail/vX.Y.Z/src/core/prepare.js" | md5sum

Use `raw.githubusercontent.com`, not `codeload`. **`codeload` caches tag
tarballs long enough to keep serving the old tree after the tag has moved**, so
it will make a successful fix look like a failure.

The publish workflow builds from `main`, so a wrong tag does not corrupt the
artifact — **it does something worse**: npm gets correct code while the tag
shows a defect the evidence document says was fixed.

## Publishing

**12. Actions → `publish` → Run workflow.** `workflow_dispatch` only. OIDC
trusted publishing; there is no token to supply.

**13. `+ reqtrail@X.Y.Z` in the publish log is the authoritative signal.** The
registry lags — **0.3.0 returned 404 for about three minutes after a green
workflow** and that was briefly read as a failed publish. Poll, do not conclude.

## After

**14. Fetch the published tarball from the registry and diff every file against
the tag.** Not the local `npm pack`. Not the file count.

    npm view reqtrail@X.Y.Z dist.tarball dist.shasum
    # download, extract, md5sum every file, diff against the tag

**v0.2.0's stale README reached npm and was found four days later**, by reading
the published package rather than the repo.

**15. Run the published binary.** Not the repo copy. `--version`, and one
command exercising whatever the release added.

**16. Write the handoff in the sitting.** **v0.2.0's publish left no record and
had to be reconstructed off npm four days afterwards.**
