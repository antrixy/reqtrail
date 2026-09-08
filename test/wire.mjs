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
import { startReceiver, parseCapture } from "../slice0/receiver.mjs";
import { __prepareForTest, run } from "../src/core/prepare.js";
import { send, wireHeaders } from "../src/transport/http.js";

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
const u = new URL(exact.url.text);

check("P-WIRE method", () => cap.method === exact.method);
check("P-WIRE target", () => cap.target === u.pathname + u.search);
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

// A secret hostname that cannot resolve. node puts the hostname in the error
// PROSE — `getaddrinfo ENOTFOUND ...` — so this is the row that proves the
// reduction to a bare code is doing something.
const bad = await run(JSON.stringify({ version: 1, variables: {},
  requests: [{ id: "r", name: "n", method: "GET", url: "http://{{$env.BADHOST}}/p",
    headers: [] }] }), { env: { ...ENV, BADHOST: "secret-host.invalid" } });
check("a failed send reports a CODE", () =>
  bad.sent === false && bad.transport.code === "ENOTFOUND");
check("a failed send does not leak the hostname node put in its message", () =>
  !JSON.stringify(bad).includes("secret-host.invalid"));

// W-REAL. The row the raw receiver structurally cannot answer.
const srv = http.createServer((q, s) => s.end("ok"));
await new Promise((res) => srv.listen(0, "127.0.0.1", res));
const { exact: e2 } = __prepareForTest(
  work(`http://127.0.0.1:${srv.address().port}`, HEADERS), { env: ENV });
const { status } = await send(e2);
srv.close();
check("W-REAL a real HTTP/1.1 server accepts the request", () => status === 200);

if (failures.length) {
  console.error(`FAIL ${failures.length} of ${passed}`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`wire ${passed}/${passed} OK`);
