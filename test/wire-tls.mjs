// P-WIRE OVER TLS, and P-VERIFY at the transport. HTTPS-PREREGISTRATION §2,
// increment 3.
//
// The same property `test/wire.mjs` checks over plain HTTP: the bytes a raw
// receiver captures agree with the exact request the core built — method,
// target, and the header block as an ORDERED SEQUENCE of name/value pairs. Here
// the receiver terminates TLS and parses nothing (`test/tls-receiver.mjs`).
//
// WHY THE SEND RUNS IN A CHILD PROCESS. Trust in the test-only certificate comes
// ONLY from `NODE_EXTRA_CA_CERTS` (D1). Node reads that variable once, at
// process start, so the send has to run in a process started with it. This
// file is both halves:
//   - with no arguments it is the PARENT. It owns the servers and the
//     assertions, and it never sends.
//   - with `--send` it is a CHILD. It builds the exact request from the same
//     workspace text, sends it, prints one JSON line, and exits.
// The parent passes the child an explicit, minimal environment, never
// `process.env`. A developer's shell cannot change what these rows measure.
//
// P-VERIFY is checked HERE as well as end to end in increment 4, because D2
// landed in `src/transport/http.js` before `run` could reach it. The untrusted
// rows also assert that the receiver captured NOTHING: a refused certificate
// must mean no request bytes reached the server, secrets included.

import https from "node:https";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { __prepareForTest } from "../src/core/prepare.js";
import { send } from "../src/transport/http.js";
import { parseCapture } from "../slice0/receiver.mjs";
import { startTlsReceiver, TEST_CERT_PATH } from "./tls-receiver.mjs";

const SELF = fileURLToPath(import.meta.url);

// Same secret and header set as test/wire.mjs, so the two files check the same
// property on the same input and differ only in the transport.
const ENV = { API_TOKEN: "s3cr3t-value" };
const HEADERS = [
  { name: "Authorization",   value: "Bearer {{$env.API_TOKEN}}" },
  { name: "X-Tag",           value: "alpha" },
  { name: "X-Other",         value: "mid" },
  { name: "X-Tag",           value: "beta" },
  { name: "x-tag",           value: "gamma" },   // same name, different casing
  { name: "X-Empty",         value: "" },
  { name: "Accept-Language", value: "en" },
];
const work = (base) => JSON.stringify({
  version: 1, variables: { baseUrl: base },
  requests: [{ id: "r", name: "n", method: "GET", url: "{{baseUrl}}/users/42?q=a%20b",
    headers: HEADERS }] });

// ---- CHILD ------------------------------------------------------------------
if (process.argv[2] === "--send") {
  const { exact } = __prepareForTest(work(process.argv[3]), { env: ENV });
  let out;
  try { out = { status: (await send(exact)).status }; }
  catch (e) { out = { code: typeof e?.code === "string" ? e.code : "no-code" }; }
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(0);
}

// ---- PARENT -----------------------------------------------------------------
let passed = 0;
const failures = [];
const check = (name, fn) => {
  passed++;
  try { if (fn() !== true) failures.push(name); }
  catch (e) { failures.push(`${name}: threw ${e.message}`); }
};

// Minimal environment for the child. PATH only, plus exactly the variables the
// row is about.
const childSend = (base, extraEnv) => new Promise((resolve, reject) => {
  execFile(process.execPath, [SELF, "--send", base],
    { env: { PATH: process.env.PATH, ...extraEnv }, encoding: "utf8", timeout: 20000 },
    (err, stdout, stderr) => {
      if (err) return reject(new Error(`child failed: ${err.message} ${stderr}`));
      try { resolve(JSON.parse(stdout.trim().split("\n").pop())); }
      catch { reject(new Error(`child printed no result: ${stdout} ${stderr}`)); }
    });
});
const TRUSTED = { NODE_EXTRA_CA_CERTS: TEST_CERT_PATH };

const r = await startTlsReceiver();
const base = `https://localhost:${r.port}`;
const { exact, view } = __prepareForTest(work(base), { env: ENV });

// Trusted send: P-WIRE over TLS.
const before = r.captures.length;
const sent = await childSend(base, TRUSTED);
check("TLS the trusted send completes", () => sent.status === 200);
check("TLS exactly one request was captured", () => r.captures.length === before + 1);
const cap = parseCapture(r.captures[before] ?? Buffer.from("\r\n\r\n"));

// Connection is the only header the runtime contributes, as over plain HTTP.
const RUNTIME = new Set(["connection"]);
const wire = cap.headers.filter((h) => !RUNTIME.has(h.name.toLowerCase()))
                        .map((h) => [h.name, h.value]);
const built = exact.headers.map((h) => [h.name, h.value.text]);
const u = new URL(exact.url.text);

check("P-WIRE/TLS method", () => cap.method === exact.method);
check("P-WIRE/TLS target", () => cap.target === u.pathname + u.search);
check("P-WIRE/TLS header block is the exact request's, pair for pair, in order", () =>
  JSON.stringify(wire) === JSON.stringify(built));
check("P-WIRE/TLS interleaving across repeated and distinct names survives", () =>
  JSON.stringify(wire.map((x) => x[0])) ===
  JSON.stringify(["Host","Authorization","X-Tag","X-Other","X-Tag","x-tag","X-Empty","Accept-Language"]));
check("P-WIRE/TLS every occurrence reaches the wire — none dropped", () =>
  wire.filter((x) => x[0].toLowerCase() === "x-tag").length === 3);
check("P-WIRE/TLS casing is preserved, including a name that differs only by case", () =>
  wire.some((x) => x[0] === "X-Tag") && wire.some((x) => x[0] === "x-tag"));
check("P-WIRE/TLS an empty value is transmitted, not dropped", () =>
  wire.some((x) => x[0] === "X-Empty" && x[1] === ""));
check("P-WIRE/TLS Connection is the ONLY runtime addition", () =>
  cap.headers.filter((h) => !built.some(([n, v]) => n === h.name && v === h.value))
     .every((h) => RUNTIME.has(h.name.toLowerCase())));
check("P-CONTAIN/TLS the secret DID reach the socket, and is in no public field", () =>
  cap.raw.includes("s3cr3t-value") && !JSON.stringify(view).includes("s3cr3t-value"));

// Untrusted: no NODE_EXTRA_CA_CERTS. The send must fail, and nothing may arrive.
const b2 = r.captures.length;
const untrusted = await childSend(base, {});
check("P-VERIFY an untrusted certificate fails the send with a code", () =>
  untrusted.status === undefined && typeof untrusted.code === "string");
check("P-VERIFY an untrusted certificate delivers NO request bytes", () =>
  r.captures.length === b2);

// Untrusted, with the environment variable that turns verification off
// process-wide. D2's explicit `rejectUnauthorized: true` must win.
const b3 = r.captures.length;
const overridden = await childSend(base, { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
check("P-VERIFY NODE_TLS_REJECT_UNAUTHORIZED=0 does not turn verification off", () =>
  overridden.status === undefined && overridden.code === untrusted.code);
check("P-VERIFY ...and still delivers NO request bytes", () =>
  r.captures.length === b3);

r.close();

// W-REAL over TLS. The raw receiver accepts anything, so it cannot say a real
// HTTPS server would. This row can.
const real = https.createServer({
  key: readFileSync(TEST_CERT_PATH.replace("-cert.pem", "-key.pem")),
  cert: readFileSync(TEST_CERT_PATH),
}, (q, s) => s.end("ok"));
await new Promise((res) => real.listen(0, "127.0.0.1", res));
const realSent = await childSend(`https://localhost:${real.address().port}`, TRUSTED);
real.close();
check("W-REAL/TLS a real HTTPS server accepts the request", () => realSent.status === 200);

if (failures.length) {
  console.error(`FAIL ${failures.length} of ${passed}`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`wire-tls ${passed}/${passed} OK`);
