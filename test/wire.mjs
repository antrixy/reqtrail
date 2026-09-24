// P-WIRE. The bytes a raw-socket receiver captures agree with the exact request
// the core built — method, target, and the header block as an ORDERED SEQUENCE
// of name/value pairs, preserving casing, relative order and repeats.
//
// Stated as a property of CAPTURED BYTES, not of a module. "The adapter passes
// the array through" is a claim about code and is the shape this project has
// stated wrongly three times. A receiver that parses before comparing cannot
// check this, which is why slice0/receiver.mjs is raw and must stay raw.
//
// THE RECEIVER IS NOT AN ORACLE FOR SENDABILITY. It accepts anything written at
// it; it never validates. Every row below passed on 2026-09-08 against a request
// carrying no Host, which a real HTTP/1.1 server answers with 400. W-REAL exists
// because P-WIRE going green is going to read as "the send works" and on its own
// it does not mean that.

import http from "node:http";
import net from "node:net";
import { startReceiver, parseCapture } from "../slice0/receiver.mjs";
import { startIpv6Receiver } from "./ipv6-receiver.mjs";
import { __prepareForTest, run } from "../src/core/prepare.js";
import { send, wireHeaders } from "../src/transport/http.js";

// COUNT TRIPWIRE (EXACT-TRANSPORT-PREREGISTRATION.md D7). A row that stops
// running — an early exit, a skipped branch, a check deleted in passing —
// used to be invisible here: the summary printed whatever ran, over itself.
// It lands before 0.5.0 adds any row, so every new row moves this number.
const EXPECTED = 28;

// IPv6 ROWS RUN OR FAIL; THEY NEVER SKIP SILENTLY (D5). They need to bind
// `::1`. If that fails the suite FAILS, naming the variable below. With
// REQTRAIL_NO_IPV6=1 they are not run, the summary line says how many and why,
// and the tripwire expects exactly that many fewer. A selftest check forbids
// the variable anywhere under .github/, so CI cannot take this exit.
const IPV6_ROWS = 2;
const NO_IPV6 = process.env.REQTRAIL_NO_IPV6 === "1";

let passed = 0;
const failures = [];
const check = (name, fn) => {
  let ok = false;
  try { ok = fn() === true; } catch (e) { failures.push(`${name}: threw ${e.message}`); passed++; return; }
  passed++;
  if (!ok) failures.push(name);
};

const ENV = { API_TOKEN: "s3cr3t-value", H: "secret.internal" };
const work = (base, headers) => JSON.stringify({
  version: 1, variables: { baseUrl: base },
  requests: [{ id: "r", name: "n", method: "GET", url: "{{baseUrl}}/users/42?q=a%20b", headers }] });

const HEADERS = [
  { name: "Authorization",   value: "Bearer {{$env.API_TOKEN}}" },
  { name: "X-Tag",           value: "alpha" },
  { name: "X-Other",         value: "mid" },
  { name: "X-Tag",           value: "beta" },
  { name: "x-tag",           value: "gamma" },   // same name, different casing
  { name: "X-Empty",         value: "" },
  { name: "Accept-Language", value: "en" },
];

const r = await startReceiver();
const base = `http://127.0.0.1:${r.port}`;
const { exact, view } = __prepareForTest(work(base, HEADERS), { env: ENV });
const before = r.captures.length;
await send(exact);
const cap = parseCapture(r.captures[before]);

// Connection is the only header the runtime contributes. Host used to be a
// second one; it is now built by the core and appears in `built` below.
const RUNTIME = new Set(["connection"]);
const wire = cap.headers.filter((h) => !RUNTIME.has(h.name.toLowerCase()))
                        .map((h) => [h.name, h.value]);
const built = exact.headers.map((h) => [h.name, h.value.text]);
check("P-WIRE method", () => cap.method === exact.method);
// REWRITTEN 0.5.0 (D6): this row compared against `u.pathname + u.search` —
// the transport's own expression, so it passed on RT-A2 by construction. The
// expected target is now written out.
check("P-WIRE target", () => cap.target === "/users/42?q=a%20b");
check("P-WIRE header block is the exact request's, pair for pair, in order", () =>
  JSON.stringify(wire) === JSON.stringify(built));
check("P-WIRE interleaving across repeated and distinct names survives", () =>
  JSON.stringify(wire.map((x) => x[0])) ===
  JSON.stringify(["Host","Authorization","X-Tag","X-Other","X-Tag","x-tag","X-Empty","Accept-Language"]));
check("P-WIRE every occurrence reaches the wire — none dropped", () =>
  wire.filter((x) => x[0].toLowerCase() === "x-tag").length === 3);
check("P-WIRE casing is preserved, including a name that differs only by case", () =>
  wire.some((x) => x[0] === "X-Tag") && wire.some((x) => x[0] === "x-tag"));
check("P-WIRE an empty value is transmitted, not dropped", () =>
  wire.some((x) => x[0] === "X-Empty" && x[1] === ""));
check("P-WIRE Connection is the ONLY runtime addition", () =>
  cap.headers.filter((h) => !built.some(([n, v]) => n === h.name && v === h.value))
     .every((h) => RUNTIME.has(h.name.toLowerCase())));

// P-CONTAIN on the transport, which is a new surface.
check("P-CONTAIN the secret DID reach the socket", () => cap.raw.includes("s3cr3t-value"));
check("P-CONTAIN the secret is in no public field", () =>
  !JSON.stringify(view).includes("s3cr3t-value"));
check("P-CONTAIN wireHeaders carries plaintext, which is its job", () =>
  wireHeaders(exact).includes("Bearer s3cr3t-value"));

// A secret hostname reaches Host on the wire and is masked everywhere else.
const b2 = r.captures.length;
const secretWs = JSON.stringify({ version: 1, variables: {},
  requests: [{ id: "r", name: "n", method: "GET", url: `http://127.0.0.1:${r.port}/p`,
    headers: [{ name: "X-H", value: "{{$env.H}}" }] }] });
const { exact: e3, view: v3 } = __prepareForTest(secretWs, { env: ENV });
await send(e3);
const c3 = parseCapture(r.captures[b2]);
check("P-CONTAIN a secret header value is on the wire and masked in the view", () =>
  c3.raw.includes("secret.internal") && !JSON.stringify(v3).includes("secret.internal"));

// P-TARGET (RT-A2). A bare `?` is shown, so it is sent. The second row states
// the property from outputs alone: the projection's URL is the scheme, the Host
// that reached the wire, and the target that reached the wire.
const b4 = r.captures.length;
const bareWs = JSON.stringify({ version: 1, variables: {},
  requests: [{ id: "r", name: "n", method: "GET", url: `http://127.0.0.1:${r.port}/p?`, headers: [] }] });
const { exact: e4, view: v4 } = __prepareForTest(bareWs, { env: ENV });
await send(e4);
const c4 = parseCapture(r.captures[b4]);
check("P-TARGET a bare ? reaches the wire", () => c4.target === "/p?");
check("P-TARGET the projection URL is scheme + wire Host + wire target", () => {
  const host = c4.headers.find((h) => h.name === "Host").value;
  return v4.projection.url === `http://${host}${c4.target}`
    && v4.projection.url === `http://127.0.0.1:${r.port}/p?`;
});

// D4's premise, pinned: when the workspace sets `Connection`, node adds none of
// its own, so the one on the wire is the one the projection shows. Measured
// 2026-09-23 before D4 was written; this row keeps it measured.
const b5 = r.captures.length;
const connWs = JSON.stringify({ version: 1, variables: {},
  requests: [{ id: "r", name: "n", method: "GET", url: `http://127.0.0.1:${r.port}/c`,
    headers: [{ name: "Connection", value: "close" }] }] });
await send(__prepareForTest(connWs, { env: ENV }).exact);
const c5 = parseCapture(r.captures[b5]);
check("P-SHOWN a workspace Connection: close is the only Connection on the wire", () => {
  const conns = c5.headers.filter((h) => h.name.toLowerCase() === "connection");
  return conns.length === 1 && conns[0].value === "close";
});

r.close();

// ---- `run` end to end, through the CLI's own use case -----------------------
// Exit code 3 became reachable in this release. These are the rows that make
// "nothing is sent" a claim about behaviour rather than a statement of fact.
const echo = http.createServer((q, s) => { s.statusCode = 404; s.end("no"); });
await new Promise((res) => echo.listen(0, "127.0.0.1", res));
const echoBase = `http://127.0.0.1:${echo.address().port}`;

const ok = await run(work(echoBase, HEADERS), { env: ENV });
check("run SENDS and reports the status", () =>
  ok.sent === true && ok.response.status === 404);
check("run returns the projection too — the diagnosis is not withheld", () =>
  ok.projection.headers.length === built.length);
check("a non-2xx answer is still a successful send", () => ok.sent === true);
check("run leaks no secret into its result", () =>
  !JSON.stringify(ok).includes("s3cr3t-value"));
echo.close();

const unres = await run(JSON.stringify({ version: 1, variables: {},
  requests: [{ id: "r", name: "n", method: "GET", url: "{{nope}}/p", headers: [] }] }),
  { env: ENV });
check("run sends NOTHING when a reference is unresolved", () =>
  unres.sent === false && unres.response === undefined && unres.transport === undefined);

// A secret target that refuses the connection. node puts the target in the
// error PROSE — `connect ECONNREFUSED 127.0.0.1:<port>` — so this is the row
// that proves the reduction to a bare code is doing something.
//
// HERMETIC SINCE 0.4.1. This row used `secret-host.invalid` and expected
// ENOTFOUND. A reserved name stops ordinary resolution; it does not stop a
// resolver or proxy from answering, and on 2026-09-23 an independent reviewer's
// environment returned HTTP 502 for it — sent: true, and this row failed with no
// defect in reqtrail. The property is unchanged; the input no longer depends on
// the machine's DNS. The ENOTFOUND class returns with an injected resolver in
// the execution release. HONESTY-PATCH-PREREGISTRATION.md D10.
const closed = http.createServer();
await new Promise((res) => closed.listen(0, "127.0.0.1", res));
const BADHOST = `127.0.0.1:${closed.address().port}`;
await new Promise((res) => closed.close(res));
// The row only means something if node really does put the target in its
// prose. Measured here rather than assumed, against the same closed port.
const prose = await new Promise((res) => {
  const q = http.request(`http://${BADHOST}/p`);
  q.on("error", (e) => res(e.message));
  q.end();
});
check("node's own error message carries the target — the row can fail", () =>
  prose.includes(BADHOST));
const bad = await run(JSON.stringify({ version: 1, variables: {},
  requests: [{ id: "r", name: "n", method: "GET", url: "http://{{$env.BADHOST}}/p",
    headers: [] }] }), { env: { ...ENV, BADHOST } });
check("a failed send reports a CODE", () =>
  bad.sent === false && bad.transport.code === "ECONNREFUSED");
check("a failed send does not leak the target node put in its message", () =>
  !JSON.stringify(bad).includes(BADHOST));

// `run` REFUSING `https` WAS RETIRED 2026-09-22 (HTTPS-PREREGISTRATION D3).
// Two rows lived here: "run REFUSES https rather than reporting a transport
// failure" and "the https refusal points at the url". They pinned the
// transport.unsupported refusal, which D3 deletes because `run` now sends
// https. They were removed BEFORE the refusal, so `main` stayed green in
// between. What they guarded is not lost: the refusal existed because 0.3.0
// shipped `https` as exit 3 when nothing had been attempted. "Code 3 means
// bytes were attempted" is now checked end to end by test/run-tls.mjs, against
// a real TLS failure.
//
// `resolve` inspecting https was never tied to the refusal, and still holds.
const httpsWs = JSON.stringify({ version: 1, variables: {},
  requests: [{ id: "r", name: "n", method: "GET", url: "https://example.com/p", headers: [] }] });
check("resolve is UNAFFECTED — https is legal to inspect", () => {
  const { view } = __prepareForTest(httpsWs, { env: ENV });
  return view.resolvable === true && view.projection.url === "https://example.com/p";
});
// `send`'s own guard is kept and is no longer reachable through `run`. It is
// exported, so it is still a boundary — exercised directly here.
//
// MOVED OFF `https:` 2026-09-22, BEFORE THE TRANSPORT LEARNED HTTPS
// (HTTPS-PREREGISTRATION increment 3). Once `send` speaks `https:`, this row
// would have gone out to example.com over the network. The property is
// unchanged: a scheme the transport cannot speak is refused, never downgraded.
// The core refuses every scheme except `http:` and `https:` (`url.scheme`), so
// no workspace can build this request. The exact request is written by hand,
// which is the only way anything reaches the guard now.
let direct = null;
try {
  // INPUT RESHAPED 0.5.0 (D2), assertion unchanged: `send` reads the scheme
  // from `exact.transport` now, so a hand-built request supplies one.
  await send({ method: "GET", url: { text: "ftp://example.com/p" }, headers: [],
    transport: { protocol: "ftp:", connectHostname: "example.com", port: 21,
      authority: "example.com", requestTarget: "/p" } });
} catch (e) { direct = e; }
check("send still guards the protocol when called directly", () =>
  direct?.code === "transport.protocol");

// W-REAL. The row the raw receiver structurally cannot answer.
const srv = http.createServer((q, s) => s.end("ok"));
await new Promise((res) => srv.listen(0, "127.0.0.1", res));
const { exact: e2 } = __prepareForTest(
  work(`http://127.0.0.1:${srv.address().port}`, HEADERS), { env: ENV });
const { status } = await send(e2);
srv.close();
check("W-REAL a real HTTP/1.1 server accepts the request", () => status === 200);

// ---- IPv6 (RT-B2), under D5 --------------------------------------------------
// On 0.4.1 the transport passed `[::1]` to node as a hostname and got ENOTFOUND
// in milliseconds. The raw receiver row checks endpoint, Host and target on the
// wire; the `run` row checks that a real server on ::1 answers, end to end.
let ipv6NotRun = 0;
const bindable = NO_IPV6 ? null : await new Promise((res) => {
  const probe = net.createServer();
  probe.once("error", (e) => res(e.code ?? "error"));
  probe.listen(0, "::1", () => probe.close(() => res(true)));
});
if (NO_IPV6) {
  ipv6NotRun = IPV6_ROWS;
} else if (bindable !== true) {
  failures.push(`IPv6: cannot bind ::1 (${bindable}). These ${IPV6_ROWS} rows need it. ` +
    "Set REQTRAIL_NO_IPV6=1 to not run them; the summary will say so.");
} else {
  const r6 = await startIpv6Receiver();
  const ws6 = JSON.stringify({ version: 1, variables: {},
    requests: [{ id: "r", name: "n", method: "GET", url: `http://[::1]:${r6.port}/ipv6?`, headers: [] }] });
  const { exact: e6 } = __prepareForTest(ws6, { env: ENV });
  const b6 = r6.captures.length;
  let sent6 = null;
  try { sent6 = await send(e6); } catch (e) { sent6 = e.code; }
  const c6 = r6.captures[b6] ? parseCapture(r6.captures[b6]) : null;
  r6.close();
  check("P-ENDPOINT an IPv6 literal is sent: Host bracketed, target intact", () =>
    sent6?.status === 200 && c6 !== null
    && c6.headers.find((h) => h.name === "Host").value === `[::1]:${r6.port}`
    && c6.target === "/ipv6?");

  const real6 = http.createServer((q, s) => s.end("ok"));
  await new Promise((res) => real6.listen(0, "::1", res));
  const run6 = await run(JSON.stringify({ version: 1, variables: {},
    requests: [{ id: "r", name: "n", method: "GET", url: `http://[::1]:${real6.address().port}/p`, headers: [] }] }),
    { env: ENV });
  real6.close();
  check("W-REAL/IPv6 run reaches a real server on ::1", () =>
    run6.sent === true && run6.response.status === 200);
}

if (failures.length) {
  console.error(`FAIL ${failures.length} of ${passed}`);
  for (const f of failures) console.error("  " + f);
}
if (passed !== EXPECTED - ipv6NotRun) {
  console.error(`FAIL count tripwire: ran ${passed} checks, expected ${EXPECTED - ipv6NotRun}`);
  process.exit(1);
}
if (failures.length) process.exit(1);
console.log(ipv6NotRun
  ? `wire ${passed}/${EXPECTED - ipv6NotRun} OK   (${ipv6NotRun} IPv6 rows NOT RUN: REQTRAIL_NO_IPV6=1)`
  : `wire ${passed}/${EXPECTED} OK`);
