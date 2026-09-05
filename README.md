# reqtrail

**See the request before it is sent.**

`reqtrail resolve` reads a workspace file and shows you the request it would
hand to the transport — method, URL, headers — together with where every
substituted value came from and what happened to it on the way.

**0.1.0 sends nothing.** There is no transport in this release. It is the
inspector; `run` arrives in 0.2.0.

    npx reqtrail resolve example.reqtrail.json

## What you see

```
$ API_TOKEN=... reqtrail resolve example.reqtrail.json --request get-user
GET https://api.example.com/users/42?q=a%20b
Authorization: Bearer ••••
X-Tag: alpha
X-Tag: beta
X-Empty:

Substitutions
  url         {{baseUrl}}         variables.baseUrl  https://api.example.com
  url         {{userId}}          variables.userId   42
  url         {{query}}           variables.query    "a b" → a%20b
  headers[0]  {{$env.API_TOKEN}}  environment        •••• (masked)
```

The arrow is the point. `{{query}}` held `a b`; what will go out is `a%20b`.
A tool that showed you `a b` would be showing you something that is not sent.

`reqtrail ui example.reqtrail.json` opens the same view in a browser, read only,
with no send button.

## The claim, and how far this release can back it

> reqtrail shows the effective request it hands to the transport — method, URL
> and headers — and where every substituted value came from, before it sends it.
> What it shows is checked against what a receiver actually recorded.

**"Effective transport input", not "the exact bytes on the wire."** The runtime
adds and transforms things reqtrail does not control: `Host`, `Connection`,
header casing at the wire level, HTTP version, TLS. A promise about wire bytes
could not be kept. A promise about what reqtrail hands the transport can be.

**Read this part carefully, because it is the honest limit of 0.1.0.**

The second sentence of the claim is true, and **you cannot reproduce it with
this release.** The comparison against a receiver was run once, before any of
this code existed, in `slice0/` — a frozen harness that built a request, sent it
through `node:http`, and compared it against raw bytes captured off a socket.
Nine sendable cases matched exactly; seven refusals reached the wire with zero
bytes. The predictions were written down first, and two of them were wrong. All
of it is in `SLICE-0-PREREGISTRATION.md` and `SLICE-0-EVIDENCE.md`, and you can
run the harness yourself.

**0.1.0 has no transport and no receiver, so what it shows you is the request
that *will be* sent — verified by slice 0, not by anything this release does on
your machine.** When `run` ships in 0.2.0, that changes.

## The workspace file

```json
{
  "version": 1,
  "variables": {
    "baseUrl": "https://api.example.com",
    "userId": "42"
  },
  "requests": [
    {
      "id": "get-user",
      "name": "Get one user",
      "method": "GET",
      "url": "{{baseUrl}}/users/{{userId}}",
      "headers": [
        { "name": "Authorization", "value": "Bearer {{$env.API_TOKEN}}" },
        { "name": "X-Tag", "value": "alpha" },
        { "name": "X-Tag", "value": "beta" }
      ]
    }
  ]
}
```

Plain JSON, deterministically serialized, yours to commit. There is a working
copy in `examples/`.

**Headers are an ordered array, not an object,** because an object cannot hold
two headers with the same name — and duplicate headers being silently collapsed
is one of the failures this tool exists to make visible.

**Two kinds of reference, and they do not compete.** `{{name}}` reads a
collection variable. `{{$env.NAME}}` reads a process environment variable and is
treated as a secret: it is held as a reference, never materialised into anything
reqtrail displays, generates or logs. In this release nothing is sent, so no
code path resolves one at all.

**Substitution is one pass.** A `{{...}}` inside a variable's value is refused,
not expanded. That is what keeps provenance a flat list rather than a tree, and
it is the constraint the whole design rests on.

**Anything ambiguous is refused, with a field path and a reason:** unmatched
braces, whitespace inside a reference, an empty or out-of-charset name, CR, LF
or NUL in a header value, a duplicate request id, an unrecognised schema
version. The layers underneath will not refuse these — an unexpanded `{{host}}`
is a perfectly valid hostname to a DNS resolver — so reqtrail does.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| `0` | Resolved completely | Read the output |
| `1` | Refused, or a reference did not resolve | Edit something |
| `2` | Usage error | Fix the command |
| `3` | Send attempted and failed | Nothing to edit; may be transient |

**Code 3 cannot occur in 0.1.0** — nothing is sent, so nothing can fail in
transit. It is listed because **exit codes are interface from this release
onward**: a code may be added, but an existing code's meaning will not change.
**Test `!= 0` rather than equality.**

`resolve` exits 1 when it cannot fully resolve **and still prints everything**.
Printing and the exit code are separate channels: you get the diagnosis, your
script gets *not sendable*. Payload on stdout, diagnostics on stderr, always —
so `--json` stays parseable.

## `reqtrail ui`

A local page served by the CLI. It binds `127.0.0.1` only, on a random port,
behind a per-session token carried in the URL fragment so it reaches no log and
no `Referer`. It requires an exact `Origin` and `Host` on every API request,
sends no CORS headers, and dies with the terminal that started it.

Those are not hardening. `reqtrail ui` is by construction a local service
holding your environment secrets, and if a web page could drive it that is an
exfiltration primitive. The mitigations are the condition of choosing a web UI
over a desktop app, and they are tested — including against a real browser, in
`test/sitting-browser.mjs`. One of them was measurably wrong before that sitting
ran; see `EVIDENCE-0.1.0.md`.

## What is not here

`run` · sending anything · responses · timeouts · redirects · `--as-curl` ·
`init` · POST and other verbs · request bodies · environment files · `--var`
overrides · imports · a request builder.

Mutable scripting is not deferred. It is refused: it is the thing that makes
provenance unanswerable.

## Requirements

Node 22 or later. **Zero runtime dependencies.** React, react-dom and esbuild
are build-time only; the published package ships the UI already built, and
nothing is fetched at runtime.

## Tests

    npm test                 selftest, UI prohibitions, parity, server rows
    npm run test:mutation    mutation coverage of the core

    npm install --no-save playwright-core
    node test/sitting-browser.mjs    the browser sitting

**Parity** is the load-bearing one: the CLI and the loopback server must produce
byte-identical output from the same input. It is what makes "the adapters own no
logic" a property rather than an intention. It failed on its first run, which was
predicted, and what it found is written down.

## Licence

MIT
