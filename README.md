# reqtrail

**Status: placeholder. Nothing is implemented yet. Do not install this.**

A local, Git-friendly CLI for running HTTP requests and inspecting exactly what
gets sent — including where every part of every value came from.

## The claim

> reqtrail shows the effective method, URL, headers, and body it hands to the
> transport, where each part of every value came from, and — for the same
> request — what a receiver actually recorded.

That last clause is the point. Most API clients can only show you their own view
of themselves. reqtrail's correctness is checked against a capture of the request
as received, not against its own report.

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

Nothing published. This repository exists to hold the name while the first
release is built. There is no installable package, no CLI, and no API.

## Licence

MIT
