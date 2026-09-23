// Drive marked values through every reachable refusal and every output channel,
// then look for two things: the secret marker, and raw terminal control
// characters.
//
// THE MATCHER NORMALISES CASE AND PERCENT-ENCODING. A literal includes() gave a
// false negative once already — `new URL()` lowercases a scheme, so a secret
// that reached output through `url.scheme` was reported clean. A leak detector
// that can only find leaks it already knows the shape of is not a detector.
//
// THE TERMINAL ORACLE IS WRITTEN INDEPENDENTLY OF THE ESCAPER. Until 0.4.1 it
// was a character-for-character copy of the regex in src/core/errors.js, so it
// could never report a character the escaper had left out — and the escaper had
// left out CR, which reached the terminal raw. The oracle is now stated with
// Unicode properties (every control except LF and tab, every bidi control, the
// line and paragraph separators) and shares no text with the implementation.
// HONESTY-PATCH-PREREGISTRATION.md, P-TERMINAL and D2.
//
// THE HUMAN CHANNEL IS STDOUT AND STDERR, ON EVERY EXIT. It used to capture
// stderr only when the command failed, so warnings printed on a successful
// resolve were never inspected.
//
// Channels: the core's thrown detail, CLI human output, CLI --json, and the
// loopback API. The DOM was NOT REACHED here while the UI rendered a blank page
// on any refusal — recording it as clean would have been the worse error. It is
// now measured in test/sitting-browser.mjs as F6, which loads a refusal
// carrying a secret in a real browser and reads the rendered document. That
// check lives there because it needs a browser, which this file does not have.

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspace } from "../src/core/prepare.js";
import { Refusal } from "../src/core/errors.js";
import { createUiServer, newToken } from "../src/server/server.js";
import { spawn } from "node:child_process";
import { TEST_CERT_PATH } from "./tls-receiver.mjs";

// Fixture count tripwire: a fixture that silently stops running would turn this
// instrument into one that reports "clean" for a path it no longer tests.
const EXPECTED_FIXTURES = 38;
const EXPECTED_ARGV_FIXTURES = 2;

// After the fix, this file is a regression test: it must exit non-zero while any
// path leaks. Today it is expected to fail, and the failure IS the measurement.
const SECRET = "Sup3rSecretLeakMarker";
const HOSTILE = "\u001b[31mHOSTILE\u001b[0m";   // a terminal escape from the file
// DEL and C1 are NOT covered by JSON.stringify, which is why the escaping helper
// is not just JSON.stringify. Mutation testing found that no fixture reached
// them: removing the DEL/C1 half of the pattern survived every check.
const HOSTILE_C1 = "a\u007fb\u009fc";
// C1 ALONE, and this fixture exists because of a coverage regression mutation
// caught. node:http ACCEPTS U+0080-U+009F, so reqtrail accepts them too — but
// they are terminal control characters and the renderer escapes them. Once
// header values were aligned to the transport, every hostile fixture above
// refused at parse and none reached the renderer, so the escaping had no test
// left. This one is accepted and must still be escaped on the way out.
const HOSTILE_ACCEPTED = "a\u009fb\u0085c";
// A hostname that CARRIES the marker and is still a legal host. `.invalid` is
// reserved (RFC 2606), so a send to it cannot leave the machine: it fails in
// the resolver, which is exactly the transport-error path this file could not
// reach while every fixture used `resolve`.
const SECRET_HOST = `${SECRET.toLowerCase()}.invalid`;
// A carriage return returns the cursor to the start of the line, so text after
// it overwrites what came before — including the `reqtrail:` prefix.
const HOSTILE_CR = "x\rFAKE: all good";
// Right-to-left override: reorders what follows on the display without any
// escape sequence. Refused in header values by the charset rule, so it reaches
// the terminal through keys, ids and provenance instead.
const HOSTILE_BIDI = "a\u202eb";
// Line separator. Not a C0 control, not escaped by JSON.stringify.
const HOSTILE_LS = "a\u2028b";
// AN UNTRUSTED TLS SERVER, IN A CHILD PROCESS. It has to be a child: the
// channels below run the binary with spawnSync, which blocks this event
// loop, and a server living here could never accept the connection.
const tlsServer = spawn(process.execPath, ["-e", `
  const tls = require("node:tls"), fs = require("node:fs");
  const [cert, key] = process.argv.slice(1);
  const s = tls.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, (x) => x.end());
  s.on("tlsClientError", () => {});
  s.listen(0, "127.0.0.1", () => console.log(s.address().port));
`, TEST_CERT_PATH, TEST_CERT_PATH.replace("-cert.pem", "-key.pem")], { stdio: ["ignore", "pipe", "inherit"] });
const TLS_PORT = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("tls child did not report a port")), 10000);
  tlsServer.stdout.once("data", (d) => { clearTimeout(t); res(Number(String(d).trim())); });
});

const dir = mkdtempSync(join(tmpdir(), "reqtrail-leak-"));
const bin = "bin/reqtrail.js";

const req = (o) => ({ id: "r", method: "GET", url: "https://a.example/", ...o });
const ws = (o) => ({ version: 1, requests: [req({})], ...o });

// One fixture per reachable refusal, carrying a marked value wherever the
// message could pick one up.
const FIXTURES = [
  // --- environment values ----------------------------------------------
  ["url.invalid / secret in host", ws({ requests: [req({ url: "https://{{$env.T}}/" })] }),
    { T: `bad host ${SECRET}` }, "secret"],
  ["url.invalid / secret is whole url", ws({ requests: [req({ url: "{{$env.T}}" })] }),
    { T: `/relative/${SECRET}` }, "secret"],
  ["url.scheme / secret supplies scheme", ws({ requests: [req({ url: "{{$env.T}}://a.example/" })] }),
    { T: `scheme${SECRET}` }, "secret"],
  ["url.secret.undisplayable", ws({ requests: [req({ url: "https://a.example/{{$env.T}}" })] }),
    { T: `a/../b${SECRET}` }, "secret"],
  ["grammar.nested / env value holds a template", ws({ requests: [req({ url: "https://a.example/{{$env.T}}" })] }),
    { T: `{{x}}${SECRET}` }, "secret"],
  ["header.control / secret holds CRLF", ws({ requests: [req({ headers: [{ name: "A", value: "{{$env.T}}" }] })] }),
    { T: `x\r\nEvil: ${SECRET}` }, "secret"],
  ["success path with a secret", ws({ requests: [req({ url: "https://a.example/?k={{$env.T}}", headers: [{ name: "A", value: "Bearer {{$env.T}}" }] })] }),
    { T: SECRET }, "secret"],
  ["warning path, set-but-empty", ws({ requests: [req({ headers: [{ name: "A", value: "{{$env.T}}" }] })] }),
    { T: "" }, "secret"],

  // --- workspace-file content ------------------------------------------
  ["schema.json", `{ ${JSON.stringify(HOSTILE)}: `, {}, "hostile-raw"],
  ["schema.unknown-key", { version: 1, requests: [], [HOSTILE]: 1 }, {}, "hostile"],
  ["schema.version.unknown", { version: HOSTILE, requests: [] }, {}, "hostile"],
  ["schema.id.charset", ws({ requests: [req({ id: `r${HOSTILE}` })] }), {}, "hostile"],
  // The first version of this fixture used a plain id and therefore tested
  // nothing; it reported clean because no marker was present. A fixture that
  // cannot exhibit the defect is not a clean result.
  ["schema.id.duplicate", ws({ requests: [req({ id: `d${HOSTILE}` }), req({ id: `d${HOSTILE}` })] }), {}, "hostile"],
  ["schema.method", ws({ requests: [req({ method: HOSTILE })] }), {}, "hostile"],
  ["schema.header.name", ws({ requests: [req({ headers: [{ name: HOSTILE, value: "v" }] })] }), {}, "hostile"],
  ["schema.type / variable value", ws({ variables: { [HOSTILE]: 1 }, requests: [req({})] }), {}, "hostile"],
  ["selection.unknown", ws({ requests: [req({ id: "a" }), req({ id: "b" })] }), {}, "hostile", HOSTILE],
  ["grammar.charset", ws({ requests: [req({ url: `https://a.example/{{${HOSTILE}}}` })] }), {}, "hostile"],
  ["grammar.whitespace", ws({ requests: [req({ url: `https://a.example/{{ ${HOSTILE} }}` })] }), {}, "hostile"],
  ["grammar.unmatched", ws({ requests: [req({ url: `https://a.example/{{${HOSTILE}` })] }), {}, "hostile"],
  ["grammar.nested / file value holds a template", ws({ variables: { a: `{{b}}${HOSTILE}` }, requests: [req({ url: "https://a.example/{{a}}" })] }), {}, "hostile"],
  ["header.control / file value holds CR", ws({ requests: [req({ headers: [{ name: "A", value: `x\r${HOSTILE}` }] })] }), {}, "hostile"],
  ["success path with hostile header value", ws({ requests: [req({ headers: [{ name: "A", value: HOSTILE }] })] }), {}, "hostile"],
  ["success path with DEL and C1 in a header value", ws({ requests: [req({ headers: [{ name: "A", value: HOSTILE_C1 }] })] }), {}, "hostile"],
  ["success path with C1 alone — accepted by the transport, escaped on display", ws({ requests: [req({ headers: [{ name: "A", value: HOSTILE_ACCEPTED }] })] }), {}, "hostile"],
  ["a variable carrying C1 into a header value", ws({ variables: { c: HOSTILE_ACCEPTED }, requests: [req({ headers: [{ name: "A", value: "{{c}}" }] })] }), {}, "hostile"],
  ["refusal carrying DEL and C1", ws({ requests: [req({ id: `d${HOSTILE_C1}` })] }), {}, "hostile"],
  ["success path with hostile variable value", ws({ variables: { v: HOSTILE }, requests: [req({ url: "https://a.example/?q={{v}}" })] }), {}, "hostile"],

  // --- 0.4.1: CR, bidi and separators (D2) --------------------------------
  ["schema.unknown-key / CR in a key", { version: 1, requests: [], [HOSTILE_CR]: 1 }, {}, "hostile"],
  ["schema.unknown-key / bidi override in a key", { version: 1, requests: [], [HOSTILE_BIDI]: 1 }, {}, "hostile"],
  ["selection.unknown / CR in --request", ws({ requests: [req({ id: "a" }), req({ id: "b" })] }), {}, "hostile", HOSTILE_CR],
  ["success path / bidi override in a query variable", ws({ variables: { v: HOSTILE_BIDI }, requests: [req({ url: "https://a.example/?q={{v}}" })] }), {}, "hostile"],
  ["success path / line separator in a query variable", ws({ variables: { v: HOSTILE_LS }, requests: [req({ url: "https://a.example/?q={{v}}" })] }), {}, "hostile"],

  // --- 0.4.1: a secret in an equivalent notation (D5) ---------------------
  // The marker cannot catch these: the secret never appears as itself. The
  // equivalent-form check below looks for the code-point notation instead.
  ["header.charset / secret is one disallowed character", ws({ requests: [req({ headers: [{ name: "A", value: "{{$env.T}}" }] })] }),
    { T: "\u0100" }, "secret"],
  ["header.charset / secret carries an emoji after the marker", ws({ requests: [req({ headers: [{ name: "A", value: "{{$env.T}}" }] })] }),
    { T: `${SECRET}\u{1F4A9}` }, "secret"],

  // --- a secret in the derived Host header ------------------------------
  // CARRIED OPEN SINCE 0.3.0. `Host` is not copied from the file, it is DERIVED
  // from the URL, so a secret hostname reaches a header nobody wrote. The
  // secret is legitimately in `exact` — the question is whether it also lands
  // in a channel a user could paste.
  ["host.derived / secret is the host",
    ws({ requests: [req({ url: "https://{{$env.T}}/p" })] }),
    { T: SECRET_HOST }, "secret"],

  // --- transport errors, carried open since 0.3.0 -----------------------
  // These two SEND. Every fixture above resolves, so nothing here could reach
  // a transport error until `run` learned https. Node's TLS and DNS errors
  // carry the hostname in `e.message` and the certificate in `e.cert`;
  // `transportCode` copies `e.code` alone, and these rows are what proves it.
  // Mode "run" skips the core and api channels: both resolve, and neither can
  // produce a transport error.
  ["transport.dns / secret hostname, send attempted",
    ws({ requests: [req({ url: "https://{{$env.T}}/p" })] }),
    { T: SECRET_HOST }, "secret", null, "run"],
  ["transport.tls / untrusted certificate, secret in a header",
    ws({ requests: [req({ url: `https://localhost:${TLS_PORT}/p`,
      headers: [{ name: "Authorization", value: "Bearer {{$env.T}}" }] })] }),
    { T: SECRET }, "secret", null, "run"],
];

// --- matching ---------------------------------------------------------------

const norm = (s) => {
  let t = String(s).toLowerCase();
  for (let i = 0; i < 3; i++) {
    try { const d = decodeURIComponent(t); if (d === t) break; t = d; } catch { break; }
  }
  return t.replace(/\\u001b|\\x1b/g, "\u001b");
};
const carriesSecret = (out) => norm(out).includes(norm(SECRET));
// EQUIVALENT FORMS. Output confidentiality is semantic, not substring: a
// secret's character named as `U+0100` discloses it without its bytes
// appearing. For every environment value in a secret fixture, the code-point
// notation of each character outside printable ASCII must be absent.
// HONESTY-PATCH-PREREGISTRATION.md P-CONTAIN and D5.
const equivalents = (env) => Object.values(env).flatMap((v) =>
  [...v].filter((c) => c.codePointAt(0) < 0x20 || c.codePointAt(0) > 0x7e)
    .map((c) => `u+${c.codePointAt(0).toString(16).padStart(4, "0")}`));
const carriesEquivalent = (out, env) => {
  const o = String(out).toLowerCase();
  return equivalents(env).some((form) => o.includes(form));
};
// Independent of src/core/errors.js by construction: Unicode properties, not
// hand-written ranges. LF and tab are the renderer's own layout.
const TERMINAL_UNSAFE = /(?![\n\t])[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/u;
const carriesControl = (out) => TERMINAL_UNSAFE.test(out);

// --- channels ---------------------------------------------------------------

function channels(fixture, env, extraArg, mode) {
  const file = join(dir, "w.json");
  writeFileSync(file, typeof fixture === "string" ? fixture : JSON.stringify(fixture));
  const args = extraArg ? ["--request", extraArg] : [];
  const verb = mode === "run" ? "run" : "resolve";
  const run = (extra) => cli([verb, file, ...args, ...extra], env);

  // A send has no core or api channel: both of those resolve.
  if (mode === "run") return { core: "", human: run([]), json: run(["--json"]), file };

  let core = "";
  try {
    core = JSON.stringify(resolveWorkspace(
      typeof fixture === "string" ? fixture : JSON.stringify(fixture),
      { env, source: "w.json", requestId: extraArg }));
  } catch (e) {
    core = e instanceof Refusal ? JSON.stringify(e.detail) : `${e.name}: ${e.message}`;
  }

  return { core, human: run([]), json: run(["--json"]), file };
}

// stdout AND stderr, whatever the exit code. See the header.
function cli(argv, env = {}) {
  const r = spawnSync(process.execPath, [bin, ...argv],
    { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return (r.stdout ?? "") + (r.stderr ?? "");
}

async function apiChannel(fixture, env, extraArg) {
  const token = newToken();
  const text = typeof fixture === "string" ? fixture : JSON.stringify(fixture);
  const ui = createUiServer({ text, file: "w.json", token, assets: new Map(), env });
  const port = await ui.listen();
  const base = `http://127.0.0.1:${port}`;
  let body = "";
  try {
    const r = await fetch(`${base}/api/resolve`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: base },
      body: JSON.stringify(extraArg ? { requestId: extraArg } : {}),
    });
    body = await r.text();
  } catch (e) { body = `fetch failed: ${e.message}`; }
  await ui.close();
  return body;
}

// --- run --------------------------------------------------------------------

const findings = [];
console.log("channel key: core / cli-human / cli-json / api      (dom: NOT REACHED)\n");

for (const [name, fixture, env, kind, extraArg, mode] of FIXTURES) {
  const ch = channels(fixture, env, extraArg, mode);
  ch.api = mode === "run" ? "" : await apiChannel(fixture, env, extraArg);

  const hit = [];
  for (const [label, out] of Object.entries(ch)) {
    if (label === "file") continue;
    if (kind === "secret" && carriesSecret(out)) hit.push(`${label}:SECRET`);
    if (kind === "secret" && carriesEquivalent(out, env)) hit.push(`${label}:SECRET-EQUIVALENT`);
    // Terminal escapes matter on the human channel; the others are consumed by
    // machines, where a control character is data rather than a command.
    if (label === "human" && carriesControl(out)) hit.push(`${label}:CONTROL`);
  }

  const verdict = hit.length ? "LEAK " : "clean";
  console.log(`  ${verdict} ${name.padEnd(42)} ${hit.join(" ")}`);
  if (hit.length) findings.push({ name, hit });
}

// --- arguments --------------------------------------------------------------
// P-TERMINAL covers what the user typed as well as what the file holds: a
// script can pass an argument it did not write. Human channel only; there is
// no workspace, so there is nothing for the core, --json or the API to show.
const ARGV_FIXTURES = [
  ["usage / CR in an unknown option", ["resolve", join(dir, "w.json"), `--${HOSTILE_CR}`]],
  ["usage / CR in an unreadable file path", ["resolve", join(dir, `missing${HOSTILE_CR}.json`)]],
];
for (const [name, argv] of ARGV_FIXTURES) {
  const hit = carriesControl(cli(argv)) ? ["human:CONTROL"] : [];
  console.log(`  ${hit.length ? "LEAK " : "clean"} ${name.padEnd(42)} ${hit.join(" ")}`);
  if (hit.length) findings.push({ name, hit });
}

const total = FIXTURES.length + ARGV_FIXTURES.length;
console.log(`\n  ${findings.length} of ${total} fixtures leak`);
const secretPaths = findings.filter((f) => f.hit.some((h) => h.includes("SECRET")));
const controlPaths = findings.filter((f) => f.hit.some((h) => h.endsWith("CONTROL")));
console.log(`  secret disclosure:      ${secretPaths.length} paths`);
console.log(`  terminal escape:        ${controlPaths.length} paths`);
console.log(`  DOM channel:            measured in sitting A as F6, not here`);

tlsServer.kill();

if (FIXTURES.length !== EXPECTED_FIXTURES || ARGV_FIXTURES.length !== EXPECTED_ARGV_FIXTURES) {
  console.error(`\n  FAIL count tripwire: ${FIXTURES.length} + ${ARGV_FIXTURES.length} fixtures, ` +
    `expected ${EXPECTED_FIXTURES} + ${EXPECTED_ARGV_FIXTURES}`);
  process.exit(2);
}
process.exit(findings.length ? 1 : 0);
