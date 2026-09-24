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
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import net from "node:net";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { __prepareForTest } from "../src/core/prepare.js";
import { send } from "../src/transport/http.js";
import { parseCapture } from "../slice0/receiver.mjs";
import { startTlsReceiver, TEST_CERT_PATH, TEST_IPV6_CERT_PATH } from "./tls-receiver.mjs";

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
  catch (e) {
    out = { code: typeof e?.code === "string" ? e.code : "no-code" };
    // NODE'S OWN REASON, for the IPv6 TLS diagnosis (0.5.0): an altname error
    // names the hostname it compared and the certificate's list, which the code
    // alone does not. Safe to print: this child only ever talks to the suite's
    // TEST-ONLY certificates, and the workspace it sends holds no secret.
    if (typeof e?.reason === "string") out.reason = e.reason;
  }
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(0);
}

// ---- PARENT -----------------------------------------------------------------
// COUNT TRIPWIRE (EXACT-TRANSPORT-PREREGISTRATION.md D7), as in wire.mjs.
// This file receives the IPv6 TLS rows, and D5 makes a skipped IPv6 row
// visible only through this number.
const EXPECTED = 20;

// IPv6 over TLS (D8), under the same run-or-fail rule as wire.mjs (D5).
const IPV6_ROWS = 4;
const NO_IPV6 = process.env.REQTRAIL_NO_IPV6 === "1";

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
check("P-WIRE/TLS method", () => cap.method === exact.method);
// REWRITTEN 0.5.0 (D6): compared against `u.pathname + u.search`, the
// transport's own expression. The expected target is now written out.
check("P-WIRE/TLS target", () => cap.target === "/users/42?q=a%20b");
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

// ---- IPv6 over TLS (D8) -----------------------------------------------------
// `send`'s TLS options are unchanged (P7): node sends no SNI for an IP literal
// and checks the certificate's IP SAN. These rows show verification is still
// ON for `[::1]` — trusted succeeds, untrusted and wrong-identity both fail
// with nothing delivered — not merely that a send completes.
let ipv6NotRun = 0;
let v6Note = "";
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
  // THE RUNTIME'S OWN VERDICT FIRST (ruled 2026-09-24, option 3). Node's
  // CVE-2026-48618 security releases broke `tls.checkServerIdentity` for IPv6
  // literals: it runs the hostname through `domainToASCII`, which returns "" for
  // `::1`, so the IP-SAN branch is skipped and a correct `IP:::1` certificate is
  // rejected, ERR_TLS_CERT_ALTNAME_INVALID — nodejs/node#64144. Measured on CI
  // at Node v22.23.2 (OpenSSL 3.5.7); fixed upstream in 26.6.0 and on v24.x,
  // not on v22.x as of 2026-09-24. Fail-closed: no security hole.
  //
  // reqtrail does NOT work around it: re-implementing identity checks in `send`
  // would break the P-VERIFY floor, in the very function the CVE was about. So
  // the rows ask THIS Node whether it accepts the certificate for `::1`, and
  // assert whichever behaviour is correct for it: a verified send where it
  // accepts, fail-closed with no bytes delivered where it does not. When Node
  // fixes 22.x, the rows switch back by themselves. The summary names the mode.
  const runtimeAcceptsV6 = tls.checkServerIdentity("::1",
    new X509Certificate(readFileSync(TEST_IPV6_CERT_PATH)).toLegacyObject()) === undefined;
  if (!runtimeAcceptsV6) v6Note = `node ${process.version} rejects IPv6 IP-SAN identity ` +
    "(nodejs/node#64144): trusted IPv6 sends asserted FAIL-CLOSED";

  const TRUSTED6 = { NODE_EXTRA_CA_CERTS: TEST_IPV6_CERT_PATH };
  const r6 = await startTlsReceiver({ ipv6: true });
  const base6 = `https://[::1]:${r6.port}`;
  const b6 = r6.captures.length;
  const sent6 = await childSend(base6, TRUSTED6);
  const c6 = r6.captures[b6] ? parseCapture(r6.captures[b6]) : null;
  // A FAILURE SAYS WHAT WAS OBSERVED. These rows first returned `false` alone,
  // and their first CI failure (4c01b77) could not be diagnosed from the log.
  if (runtimeAcceptsV6) {
    check("P-ENDPOINT/TLS an IPv6 literal is sent verified: Host bracketed, target intact", () => {
      const host = c6?.headers.find((h) => h.name === "Host")?.value;
      if (sent6.status !== 200 || c6 === null || host !== `[::1]:${r6.port}`
          || c6.target !== "/users/42?q=a%20b") {
        throw new Error(`child ${JSON.stringify(sent6)}, captured ` +
          (c6 ? `Host ${JSON.stringify(host)} target ${JSON.stringify(c6.target)}` : "nothing"));
      }
      return true;
    });
  } else {
    check("P-VERIFY/IPv6 this Node rejects IPv6 identity (#64144): the send fails closed, NO bytes", () => {
      if (sent6.code !== "ERR_TLS_CERT_ALTNAME_INVALID" || c6 !== null) {
        throw new Error(`child ${JSON.stringify(sent6)}, captured ${c6 ? "request bytes" : "nothing"}`);
      }
      return true;
    });
  }
  const b7 = r6.captures.length;
  const untrusted6 = await childSend(base6, {});
  check("P-VERIFY/IPv6 an untrusted certificate fails and delivers NO request bytes", () => {
    if (untrusted6.status !== undefined || typeof untrusted6.code !== "string"
        || r6.captures.length !== b7) {
      throw new Error(`child ${JSON.stringify(untrusted6)}, ${r6.captures.length - b7} captured`);
    }
    return true;
  });
  r6.close();

  // Trusted, but the certificate names `localhost`, not `::1`. The identity
  // check must run for an IP literal and refuse it.
  const rm = await startTlsReceiver({ ipv6: true, cert: "localhost" });
  const mismatch6 = await childSend(`https://[::1]:${rm.port}`, TRUSTED);
  check("P-VERIFY/IPv6 a trusted certificate for another identity fails, NO bytes", () => {
    if (mismatch6.code !== "ERR_TLS_CERT_ALTNAME_INVALID" || rm.captures.length !== 0) {
      throw new Error(`child ${JSON.stringify(mismatch6)}, ${rm.captures.length} captured`);
    }
    return true;
  });
  rm.close();

  let real6Requests = 0;
  const real6 = https.createServer({
    key: readFileSync(TEST_IPV6_CERT_PATH.replace("-cert.pem", "-key.pem")),
    cert: readFileSync(TEST_IPV6_CERT_PATH),
  }, (q, s) => { real6Requests++; s.end("ok"); });
  await new Promise((res) => real6.listen(0, "::1", res));
  const realSent6 = await childSend(`https://[::1]:${real6.address().port}`, TRUSTED6);
  real6.close();
  if (runtimeAcceptsV6) {
    check("W-REAL/TLS/IPv6 a real HTTPS server on ::1 accepts the request", () => {
      if (realSent6.status !== 200) throw new Error(`child ${JSON.stringify(realSent6)}`);
      return true;
    });
  } else {
    check("W-REAL/TLS/IPv6 this Node rejects IPv6 identity (#64144): no request reaches the server", () => {
      if (realSent6.code !== "ERR_TLS_CERT_ALTNAME_INVALID" || real6Requests !== 0) {
        throw new Error(`child ${JSON.stringify(realSent6)}, ${real6Requests} request(s) served`);
      }
      return true;
    });
  }
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
  ? `wire-tls ${passed}/${EXPECTED - ipv6NotRun} OK   (${ipv6NotRun} IPv6 rows NOT RUN: REQTRAIL_NO_IPV6=1)`
  : `wire-tls ${passed}/${EXPECTED} OK` + (v6Note ? `   (${v6Note})` : ""));
