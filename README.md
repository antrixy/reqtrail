# reqtrail

**Status: name placeholder. `reqtrail` is published on npm at 0.0.1, but that
package contains no code — only this README and a licence. There is nothing to
install and nothing to run.**

A local, Git-friendly CLI for running HTTP requests and inspecting exactly what
gets sent — including where every part of every value came from.

## The claim

> reqtrail shows the effective request it hands to the transport — method, URL
> and headers — and where every substituted value came from, before it sends it.

**"Effective transport input", not "the exact bytes on the wire".** The runtime
adds and transforms things reqtrail does not control: `Host`, `Connection`,
`Accept-Encoding`, header casing, URL encoding, default ports, HTTP version,
TLS. A promise about wire bytes could not be kept. A promise about what reqtrail
hands the transport can be.

### How that claim is checked

Most API clients can only show you their own view of themselves. reqtrail's view
is verified against a capture of the request **as a receiver recorded it** —
raw bytes, not a parsed object, because casing, ordering and repeated headers
are exactly what is under test.

**That verification is how the tool is built and tested, not a feature it
ships.** reqtrail does not run a capture on your requests. The comparison is run
once, against an adversarial fixture set, and if the displayed request cannot be
made to match the captured one, the claim above is false and the rest is not
built.

## What is planned for the first release

- Requests defined in local JSON files, deterministically serialized
- GET only
- Collection-level `{{name}}` substitution, one scope
- Secrets referenced from the environment, held as references and never
  materialized into any displayed output
- Per-segment provenance: which variable, or which literal, produced each part
  of the resolved URL and headers
- Redirects refused — the 3xx is the response
- Two commands: `resolve` and `run`

Deliberately not in the first release: a request builder, other HTTP methods,
request bodies, environment files, imports, and any UI.

## Why the scope is this small

The interesting question is whether a displayed request can be made to match a
sent request. Variable substitution inserts text verbatim; the URL layer then
normalizes what it receives. A space, a percent sign, a non-ASCII character, or a
trailing slash can each make the displayed request and the sent request differ.

If that gap cannot be closed, the claim above is false and there is no reason to
build the rest. That test comes first.

## Status

`reqtrail@0.0.1` was published to npm on 2026-09-01 to hold the name and to
verify the release pipeline. **It ships no executable code**: the package
contains this README and the licence, and declares no `bin`. There is no CLI
and no API yet.

Nothing in this document describes shipped behaviour. Everything under "What is
planned" is planned.

## Licence

MIT
