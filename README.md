# reqtrail

**See the request before it is sent.**

`reqtrail resolve` reads a workspace file and shows you the request it would
hand to the transport — method, URL, headers — together with where every
substituted value came from and what happened to it on the way. `reqtrail run`
shows you the same thing and then sends it.

**`resolve` sends nothing, ever.** That is not a limit of a version; it is what
the verb means. Nothing leaves your machine until you type `run`.

Save the workspace file from [The workspace file](#the-workspace-file) below as
`example.reqtrail.json`, then:

    npx reqtrail resolve example.reqtrail.json --request get-user

The same file ships inside the package at `examples/example.reqtrail.json`.

## What you see

```
$ API_TOKEN=... reqtrail resolve example.reqtrail.json --request get-user
GET https://api.example.com/users/42?q=a%20b
Host: api.example.com  (derived)
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

**`Host` is not in the file**, which is what `(derived)` marks. reqtrail
derives it from the URL and shows it,
because it goes on the wire and a request without it is answered with 400. It
carries `"origin": "derived"` in `--json`, where every other header carries
`"origin": "workspace"` — so a consumer can tell what you wrote from what
reqtrail added, and the display is not quietly claiming you wrote it. A
workspace that sets `Host` itself is refused rather than merged: two would be a
request-smuggling shape.

`reqtrail ui example.reqtrail.json` opens the same view in a browser. **It is
read only and has no send button** — sending is the CLI's job, and a page in a
browser that can make your machine emit authenticated requests is a larger
security question than this tool has answered.

## The claim, and how far it is backed

> reqtrail shows the effective request it hands to the transport — method, URL
> and headers — and where every substituted value came from, before it sends it.
> What it shows is checked against what a receiver actually recorded.

**"Effective transport input", not "the exact bytes on the wire."** The runtime
adds and transforms things reqtrail does not control: `Connection`, HTTP
version, TLS. A promise about wire bytes could not be kept. A promise about what
reqtrail hands the transport can be.

**`Host` used to be on that list and no longer is.** It was there because the
transport supplied it, invisibly, from an object of headers. reqtrail now passes
an ordered array, the transport supplies no `Host`, and reqtrail derives and
displays its own — which leaves `Connection` as the only header that reaches a
receiver without appearing above.

**Read this part carefully, because it is where the claim is actually earned.**

The second sentence used to be unreproducible. It is not any more, and the
change is worth stating plainly rather than quietly.

A wire check ([`test/wire.mjs`](https://github.com/antrixy/reqtrail/blob/main/test/wire.mjs))
runs on every `npm test`. It builds a request through the same
core the CLI uses, sends it through the real transport, and compares what a
raw-socket receiver recorded — method, target, and the header block as an
ordered sequence of name/value pairs, casing and repeats preserved — against the
request the core built. **Not a claim about code: a comparison of captured
bytes.** It then sends the same request at a real HTTP/1.1 server, because a raw
receiver accepts anything written at it and is not an oracle for whether a real
server would.

`slice0/` is still there, and it is still the reason any of this was attempted.
It ran once, before any of this code existed: nine sendable cases matched
exactly, seven refusals reached the wire with zero bytes, the predictions were
written down first, and two of them were wrong. `SLICE-0-PREREGISTRATION.md` and
`SLICE-0-EVIDENCE.md` record it and you can run the harness yourself.

**What reqtrail shows you is checked against what a receiver recorded, on your
machine, every time the suite runs.**

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
treated as a secret: **it never appears in anything reqtrail displays, generates
or logs.** Resolving it happens inside the core, wherever a decision needs the
real bytes — normalization has to see them to tell you it changed them, and the
header checks have to see them to find a control character — and none of those
values reaches an output. That is checked rather than asserted:
[`test/leak-audit.mjs`](https://github.com/antrixy/reqtrail/blob/main/test/leak-audit.mjs) drives a marked secret through every refusal and every
channel and reports zero.

Two earlier versions of this paragraph got it wrong in the same direction. The
first said no code path resolved a secret at all; three refusals leaked as a
result. The second said exactly one module resolved one; there are three. **The
guarantee is about the outputs, not about the module list** — see
[`LEAK-AUDIT-EVIDENCE.md`](https://github.com/antrixy/reqtrail/blob/main/LEAK-AUDIT-EVIDENCE.md).

**Substitution is one pass.** A `{{...}}` inside a variable's value is refused,
not expanded. That is what keeps provenance a flat list rather than a tree, and
it is the constraint the whole design rests on.

**Anything ambiguous is refused, with a field path and a reason:** an unclosed
`{{`, whitespace inside a reference, an empty or out-of-charset name, a variable
name no `{{...}}` could reference, CR, LF or NUL in a header value, a duplicate
request id, **a duplicate key in any object**, and an unrecognised schema
version.

**Header values are limited to what the transport accepts:** tab, `U+0020`–
`U+007E` and `U+0080`–`U+00FF`. Anything else — an ANSI escape, DEL, a vertical
tab, any emoji — is refused, naming the code point and the variable that carried
it. The set was established by measuring `node:http`, and the rule is stated as
a property of the workspace format rather than of the transport: a request that
cannot be sent should not be called sendable.

`U+0080`–`U+00FF` is accepted **and warned about**. Those characters go on the
wire as single Latin-1 bytes, not UTF-8 — `café` leaves as `63 61 66 e9` — so a
file authored in UTF-8 sends something its author did not intend. reqtrail tells
you; it does not decide for you.

A stray `}}` is **not** refused — it is ordinary text. `{{` can only mean the
start of a template, but `}}` is the end of any nested JSON object, and values
in a tool like this routinely contain JSON fragments: refusing
`{"a":{"b":1}}` in a header value would cost more than the symmetry is worth. The layers underneath will not refuse these — an unexpanded `{{host}}`
is a perfectly valid hostname to a DNS resolver — so reqtrail does.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| `0` | Resolved completely | Read the output |
| `1` | Refused, or a reference did not resolve | Edit something |
| `2` | Usage error | Fix the command |
| `3` | Send attempted and failed | Nothing to edit; may be transient |

**Code 3 means bytes were attempted.** An `https://` URL is code 1, not 3:
`resolve` will show it, `run` refuses it, and the fix is in your file.

**Code 3 is `run` only.** `resolve` never sends, so nothing can fail in transit;
an unresolved reference is code 1 under both verbs, because nothing was sent and
the instruction is still *edit something*. **A non-2xx response is code 0**: the
send worked and the server answered, and whether you like the answer is your
business, not the exit code's.

**Exit codes are interface.** A code may be added, but an existing code's
meaning will not change. **Test `!= 0` rather than equality.**

`resolve` and `run` both exit 1 when a reference does not resolve, **and still
print everything**.
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
[`test/sitting-browser.mjs`](https://github.com/antrixy/reqtrail/blob/main/test/sitting-browser.mjs). One of them was measurably wrong before that sitting
ran; see [`EVIDENCE-0.1.0.md`](https://github.com/antrixy/reqtrail/blob/main/EVIDENCE-0.1.0.md).

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

The test suite is in the repository, not in the npm package. The slice-0
harness and its records **are** in the package, because this file points you at
them: `slice0/`, `SLICE-0-PREREGISTRATION.md`, `SLICE-0-EVIDENCE.md`.

**Parity** is the load-bearing one: the CLI and the loopback server must produce
byte-identical output from the same input. It is what makes "the adapters own no
logic" a property rather than an intention. It failed on its first run, which was
predicted, and what it found is written down.

## Licence

MIT
