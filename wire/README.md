# wire — the LIVE rig for P-WIRE

**This directory is not frozen.** That is the whole reason it exists separately
from `../slice0/`.

`slice0/` is the frozen go/no-go record for 0.1.0. Its README says editing it
invalidates `../SLICE-0-EVIDENCE.md`, and `package.json` ships `slice0/`,
`SLICE-0-PREREGISTRATION.md` and `SLICE-0-EVIDENCE.md` to npm, so the rig and
the document that reports its output are read together by installers.

`TRANSPORT-PREREGISTRATION.md` §3 says *"Fix `slice0/run.mjs` first."* Taken as
an in-place edit that changes what the frozen rig outputs, and therefore makes
the frozen evidence beside it wrong:

    SLICE-0-EVIDENCE.md, P8   node:http adds two: Host, Connection
    repaired send side        node:http adds one: Connection

**The repair is a behaviour change, which is the study, not a repair to a false
claim.** That is `import-fidelity-spike`'s line, cited by `slice0/README.md`
itself: *a frozen artifact must stay frozen, and must not stay wrong about
itself.* The frozen rig is not wrong about itself — it is an accurate record of
a lossy send side. So the resolution is the one the `import-fidelity-spike`
reviewer reached: **keep the frozen artifact frozen and put the corrected work
in a live one.**

## What is imported, and what that commits to

`../slice0/receiver.mjs` and `../slice0/prepare.mjs` are **imported unchanged**.
Reading a frozen file does not break its freeze. The receiver was correct from
the start — raw socket, verbatim bytes — and is the reason P-WIRE is checkable
at all.

**Named trigger, so it is not discovered under pressure:** the first time this
rig needs the receiver or `prepare.mjs` to *behave differently* — a request body
for POST is the obvious one, since the receiver captures only up to the header
block — that file is copied into `wire/` and `slice0/`'s copy stays frozen. Not
before. One home until a divergence is actually required.

## Files

    run.mjs            the repaired send side. Reproduces slice 0's P-rows and
                       adds W1-W3 for what the object collapse could not express.
    collapse-demo.mjs  one ordered array sent both ways against the same
                       receiver. Separates "node:http cannot" from "the harness
                       cannot", the role probe-dup.mjs played for the transport.

## Running it

    node run.mjs             expect 10/10
    node collapse-demo.mjs   expect 4 occurrences sent, 2 captured under the
                             collapse, 4 under the flat array

## The repair

`slice0/run.mjs:14-17` built an object from the ordered array. `node:http`
accepts a **flat array** `[name, value, name, value, ...]` and writes it in the
given order, preserving repeated names, interleaving across distinct names, and
name casing.

## W3 is a measurement, not a prediction that held

Under array headers **`node:http` supplies no `Host`**, and `setHost: true` does
not restore it. This was measured in a probe **before this file was written**,
so W3 is written to an observation. It is recorded that way rather than dressed
as a prediction, because a prediction written after the measurement is not one.

A real HTTP/1.1 server answers the Host-less request with **400**. Supplying
`Host` explicitly in the array reaches 200. **Host construction therefore moves
from the runtime into reqtrail** — a scope consequence for the transport
adapter, not a rig detail.
