// The seven UI security rows and the ten server protection rows are ACCEPTANCE
// CRITERIA for 0.1.0, each tested. A release that ships the UI without them
// ships the vulnerability.
//
// The API is POST-only and requires an exact `Origin`. That is not a REST
// opinion: sitting A measured that a browser sends no `Origin` on a same-origin
// GET, so an Origin check on a GET endpoint permits an absent header and
// therefore checks nothing. See src/server/server.js.
//
// What this file cannot test is the browser's own behaviour. That is sitting A
// (test/sitting-browser.mjs); asserting it from a Node client would be a green
// result that proves nothing.

import http from "node:http";
import net from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createUiServer, newToken, LIMITS } from "../src/server/server.js";

const EXPECTED = 51;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "examples", "example.reqtrail.json");
const text = readFileSync(file, "utf8");
const ENV = { API_TOKEN: "s3cr3t-value-1234" };

let ran = 0;
const failures = [];
async function check(name, fn) {
  ran++;
  try {
    if ((await fn()) !== true) throw new Error("returned false");
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

const token = newToken();
const assets = new Map([
  ["/", { body: Buffer.from("<!doctype html>"), type: "text/html; charset=utf-8" }],
  ["/app.js", { body: Buffer.from("// bundle"), type: "text/javascript; charset=utf-8" }],
]);

const ui = createUiServer({ text, file, token, assets, env: ENV });
const port = await ui.listen();
const base = `http://127.0.0.1:${port}`;

// A well-formed browser-shaped API call, and its parts, so a single property
// can be removed per check.
const ORIGIN = { origin: base };
const JSONCT = { "content-type": "application/json" };
const AUTH = { authorization: `Bearer ${token}` };
const good = { ...ORIGIN, ...JSONCT, ...AUTH };

const post = (path, headers = good, body = "{}") =>
  fetch(`${base}${path}`, { method: "POST", headers, body });

// Raw request, so Host and malformed input can be controlled exactly.
function raw(payload, { wait = 400 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(payload));
    let data = "";
    socket.on("data", (c) => { data += c; });
    setTimeout(() => { socket.destroy(); resolve({ data }); }, wait);
  });
}

const rawApi = (extra = "") =>
  raw(`POST /api/session HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
    `Origin: ${base}\r\nAuthorization: Bearer ${token}\r\n` +
    `Content-Type: application/json\r\nContent-Length: 2\r\n${extra}` +
    `Connection: close\r\n\r\n{}`);

// ------------------------------------------------- UI rows 1, 2: binding ----

await check("row 1 — bound to 127.0.0.1 only", () =>
  ui.server.address().address === "127.0.0.1");
await check("row 2 — a high port, chosen at startup", () => port >= 1024);
await check("row 2 — a second session gets a different port", async () => {
  const other = createUiServer({ text, file, token, assets, env: ENV });
  const p2 = await other.listen();
  await other.close();
  return p2 !== port;
});

// ------------------------------------------------------- UI row 3: token ----

await check("row 3 — no token is 401", async () =>
  (await post("/api/session", { ...ORIGIN, ...JSONCT })).status === 401);
await check("row 3 — a wrong token is 401", async () =>
  (await post("/api/session", { ...ORIGIN, ...JSONCT,
    authorization: "Bearer wrong" })).status === 401);
await check("row 3 — a same-length wrong token is 401", async () =>
  (await post("/api/session", { ...ORIGIN, ...JSONCT,
    authorization: `Bearer ${newToken()}` })).status === 401);
await check("row 3 — the right token is 200", async () =>
  (await post("/api/session")).status === 200);
await check("row 3 — tokens are 256 bits of randomness", () =>
  newToken().length >= 43 && newToken() !== newToken());
// A SOURCE-LEVEL check, and it is labelled as one. Constant-time comparison
// cannot be demonstrated behaviourally by this suite — a wrong token is
// rejected either way, which is exactly why the mutation pass found this
// unprotected. What is checkable is that the code reaches for the constant-time
// primitive rather than `===`, and that is what this asserts. It does not
// establish that the comparison is timing-safe in fact.
await check("row 3 — the token comparison uses a constant-time primitive", () => {
  const src = readFileSync(join(root, "src", "server", "server.js"), "utf8");
  return /timingSafeEqual\(/.test(src) && !/presented === token|token === presented/.test(src);
});
await check("row 3 — NOT a cookie: no Set-Cookie is ever sent", async () =>
  (await post("/api/session")).headers.get("set-cookie") === null);
await check("row 3 — a token in a Cookie header is not accepted", async () =>
  (await post("/api/session", { ...ORIGIN, ...JSONCT,
    cookie: `token=${token}` })).status === 401);

// ---------------------------------------------- UI row 4: Origin and Host ----

await check("row 4 — a foreign Origin is refused", async () =>
  (await post("/api/session", { ...good, origin: "https://evil.example" })).status === 403);
await check("row 4 — the exact loopback Origin is accepted", async () =>
  (await post("/api/session")).status === 200);
await check("row 4 — an Origin on the wrong port is refused", async () =>
  (await post("/api/session", { ...good,
    origin: `http://127.0.0.1:${port + 1}` })).status === 403);
await check("row 4 — an https Origin on the same port is refused", async () =>
  (await post("/api/session", { ...good,
    origin: `https://127.0.0.1:${port}` })).status === 403);
// From sitting A: absent must be refused on the API, or the check is vacuous
// for any request a browser sends without one.
await check("row 4 — an ABSENT Origin is refused on the API", async () =>
  (await post("/api/session", { ...JSONCT, ...AUTH })).status === 403);
await check("row 4 — an absent Origin is allowed on a static route", async () =>
  (await fetch(`${base}/`)).status === 200);
await check("row 4 — a foreign Origin is refused on a static route too", async () =>
  (await fetch(`${base}/`, { headers: { origin: "https://evil.example" } })).status === 403);
await check("row 4 — a rebinding Host is refused (the rebinding defence)", async () => {
  const r = await raw(`POST /api/session HTTP/1.1\r\nHost: evil.example:${port}\r\n` +
    `Origin: ${base}\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`);
  return r.data.includes("403") && r.data.includes("bad-host");
});
await check("row 4 — localhost is not accepted as an alias for 127.0.0.1", async () => {
  const r = await raw(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
  return r.data.includes("403") && r.data.includes("bad-host");
});
await check("row 4 — the Host check runs before the token check", async () => {
  const r = await raw(`POST /api/session HTTP/1.1\r\nHost: evil.example:${port}\r\n` +
    `Connection: close\r\n\r\n`);
  return r.data.includes("bad-host") && !r.data.includes("unauthorized");
});
// P8, pre-registered: node:http does not validate Host, so the check must be ours.
await check("P8 — a foreign Host reaches our handler, not node's", async () => {
  const r = await raw(`GET / HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n`);
  return r.data.includes("bad-host");
});

// ---------------------------------------------------------- UI row 5: CORS ----

await check("row 5 — no CORS header on a success", async () => {
  const r = await post("/api/session");
  return [...r.headers.keys()].every((k) => !k.startsWith("access-control-"));
});
await check("row 5 — no CORS header on a refusal", async () => {
  const r = await post("/api/session", { ...good, origin: "https://evil.example" });
  return [...r.headers.keys()].every((k) => !k.startsWith("access-control-"));
});
await check("row 5 — OPTIONS is not a preflight endpoint", async () =>
  (await fetch(`${base}/api/resolve`,
    { method: "OPTIONS", headers: good })).status === 405);

// ------------------------------------------------- UI row 6: dies with us ----

await check("row 6 — closing stops the listener", async () => {
  const other = createUiServer({ text, file, token, assets, env: ENV });
  const p = await other.listen();
  await other.close();
  return await new Promise((resolve) => {
    const s = net.connect(p, "127.0.0.1");
    s.on("error", () => resolve(true));
    s.on("connect", () => { s.destroy(); resolve(false); });
  });
});
await check("row 6 — no daemon: the listener belongs to this process", () =>
  ui.server.listening === true);

// ------------------------------------------------ server row 6: dispatch ----

await check("row 6 — an unknown path is 404", async () =>
  (await post("/nope")).status === 404);
await check("row 6 — a known path with the wrong method is 405", async () =>
  (await fetch(`${base}/api/resolve`, { method: "GET", headers: good })).status === 405);
await check("row 6 — GET is refused on the read-only API too", async () =>
  (await fetch(`${base}/api/session`, { method: "GET", headers: good })).status === 405);
await check("row 6 — POST to a static route is 405", async () =>
  (await post("/")).status === 405);
await check("row 6 — a query string is not part of dispatch", async () =>
  (await post("/api/session?x=1")).status === 404);
await check("row 6 — static delivery never touches the filesystem", async () => {
  const r = await raw(`GET /../package.json HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
    `Connection: close\r\n\r\n`);
  return r.data.includes("404") && !r.data.includes("reqtrail");
});
await check("row 6 — percent-encoded traversal is just an unknown route", async () =>
  (await fetch(`${base}/%2e%2e%2fpackage.json`)).status === 404);

// ------------------------------------------ server rows 1, 2, 5, 10: input ----

await check("row 1 — too many headers is 431", async () => {
  const extra = {};
  for (let i = 0; i < LIMITS.maxHeaderCount + 10; i++) extra[`x-h${i}`] = "v";
  return (await post("/api/session", { ...good, ...extra })).status === 431;
});
// P7, pre-registered: an oversized header BLOCK is rejected by the parser before
// any handler runs, with a status rather than a bare socket reset.
await check("P7 — an oversized header block is rejected with a status", async () => {
  const big = "x".repeat(LIMITS.maxHeaderSize + 2048);
  const r = await rawApi(`X-Big: ${big}\r\n`);
  return r.data.includes("431");
});
await check("row 2 — an oversized JSON body is 413", async () => {
  const r = await post("/api/resolve", good,
    JSON.stringify({ requestId: "x".repeat(LIMITS.maxBodyBytes + 1024) }));
  return r.status === 413;
});
// ROUTE BY ROUTE, and this is the point of the check rather than a repetition.
// /api/session used to answer without reading its body, so rows 2 and 4 held on
// /api/resolve alone — and the mutant for the body limit passed anyway, because
// the other route enforced it. A row covered on one route is not covered.
await check("row 2 — the limit applies to /api/session too", async () => {
  const r = await post("/api/session", good,
    JSON.stringify({ pad: "x".repeat(LIMITS.maxBodyBytes + 1024) }));
  return r.status === 413;
});
// Row 4's OTHER half. The stalled-header case is node's `headersTimeout`; this
// is ours, and it had never fired in a test. Code that has never run is not
// known to work. Uses the shipped value, for the reason recorded against the
// stalled-header check.
await check("row 5 — a non-JSON content type is 415", async () =>
  (await post("/api/resolve", { ...ORIGIN, ...AUTH,
    "content-type": "text/plain" })).status === 415);
await check("row 5 — a missing content type is 415", async () =>
  (await post("/api/resolve", { ...ORIGIN, ...AUTH })).status === 415);
await check("row 5 — application/json with a charset is accepted", async () =>
  (await post("/api/resolve", { ...good, "content-type": "application/json; charset=utf-8" },
    JSON.stringify({ requestId: "get-user" }))).status === 200);
// Row 10: an unauthenticated caller must not get to spend our memory. If the
// body were read first this would be 413, not 401.
await check("row 10 — auth is checked before the body is read", async () =>
  (await post("/api/resolve", { ...ORIGIN, ...JSONCT },
    JSON.stringify({ pad: "x".repeat(LIMITS.maxBodyBytes * 2) }))).status === 401);
await check("malformed JSON is 400, not 500", async () =>
  (await post("/api/resolve", good, "{oops")).status === 400);

// --------------------------------------------- server rows 3, 4: timeouts ----

// P6, pre-registered: node's defaults (300s request, 60s headers) are too
// permissive, so rows 3 and 4 are held by our configuration, not the default.
await check("P6 — node's defaults are more permissive than our limits", () => {
  const stock = http.createServer();
  const ok = stock.requestTimeout > LIMITS.requestTimeoutMs &&
    stock.headersTimeout > LIMITS.headersTimeoutMs;
  stock.close();
  return ok;
});
await check("rows 3, 4 — our timeouts are the ones in effect", () =>
  ui.server.requestTimeout === LIMITS.requestTimeoutMs &&
  ui.server.headersTimeout === LIMITS.headersTimeoutMs);
await check("rows 3, 4 — the enforcement interval is set, not left at 30s", () =>
  LIMITS.connectionsCheckingIntervalMs <= LIMITS.headersTimeoutMs);

// The two five-second timeout measurements live in test/server-slow.mjs. They
// use the SHIPPED values deliberately, which is the whole reason they are slow
// and the reason they are not weakened. Split by COST rather than by
// importance: this suite is run sixteen times by the mutation pass, and the
// declared-suite mechanism sends the timeout mutants to the file that can kill
// them, so no check loses its oracle.

// ------------------------------------------ server rows 7, 8: error shape ----

await check("row 7 — errors are uniform JSON", async () => {
  const r = await post("/nope");
  const body = await r.json();
  return r.headers.get("content-type").startsWith("application/json") &&
    typeof body.error.code === "string" && typeof body.error.message === "string";
});
// NOTE: this check deliberately provokes an internal error, so the server
// writes a stack trace to ITS OWN stderr and it appears in this suite's output.
// That is the behaviour under test working — the browser gets no trace, the
// operator does. A silent run here would mean the operator logging had been
// lost.
await check("row 8 — an internal throw yields 500 with no stack trace", async () => {
  const broken = createUiServer({
    text: "{ not json", file: "broken.json", token, assets, env: ENV,
  });
  const p = await broken.listen();
  const r = await fetch(`http://127.0.0.1:${p}/api/session`, {
    method: "POST",
    headers: { origin: `http://127.0.0.1:${p}`, ...JSONCT, ...AUTH },
    body: "{}",
  });
  const body = await r.text();
  await broken.close();
  return r.status === 500 && !body.includes("at ") && !body.includes(".js:");
});
await check("row 8 — no response body names a source file", async () => {
  const bodies = await Promise.all([
    post("/nope"), post("/api/session", { ...ORIGIN, ...JSONCT }),
    post("/api/resolve", good, "{"),
  ].map(async (p) => (await p).text()));
  return bodies.every((b) => !b.includes("/src/") && !b.includes(".js:"));
});

// ------------------------------------------------------- secret boundary ----

await check("no secret crosses the loopback boundary", async () => {
  const r = await post("/api/resolve", good, JSON.stringify({ requestId: "get-user" }));
  return !(await r.text()).includes(ENV.API_TOKEN);
});
await check("a refusal over the API carries a code and a path", async () => {
  const r = await post("/api/resolve", good, JSON.stringify({ requestId: "nope" }));
  const body = await r.json();
  return body.error.code === "selection.unknown" && body.error.path === "requests";
});

await ui.close();

if (failures.length) {
  console.error(`FAIL ${failures.length} of ${ran}`);
  for (const f of failures) console.error("  " + f);
}
if (ran !== EXPECTED) {
  console.error(`FAIL count tripwire: ran ${ran} checks, expected ${EXPECTED}`);
  process.exit(1);
}
if (failures.length) process.exit(1);
console.log(`server ${ran}/${EXPECTED} OK   (the browser half is sitting A)`);
