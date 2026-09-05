// Drive marked values through every reachable refusal and every output channel,
// then look for two things: the secret marker, and raw terminal control
// characters.
//
// THE MATCHER NORMALISES CASE AND PERCENT-ENCODING. A literal includes() gave a
// false negative once already — `new URL()` lowercases a scheme, so a secret
// that reached output through `url.scheme` was reported clean. A leak detector
// that can only find leaks it already knows the shape of is not a detector.
//
// Channels: the core's thrown detail, CLI human output, CLI --json, and the
// loopback API. The DOM is NOT REACHED and says so — the UI renders a blank page
// on any refusal, so there is nothing to inspect until that is fixed. Recording
// it as clean would be the worse error.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspace } from "../src/core/prepare.js";
import { Refusal } from "../src/core/errors.js";
import { createUiServer, newToken } from "../src/server/server.js";

// Fixture count tripwire: a fixture that silently stops running would turn this
// instrument into one that reports "clean" for a path it no longer tests.
const EXPECTED_FIXTURES = 26;

// After the fix, this file is a regression test: it must exit non-zero while any
// path leaks. Today it is expected to fail, and the failure IS the measurement.
const SECRET = "Sup3rSecretLeakMarker";
const HOSTILE = "\u001b[31mHOSTILE\u001b[0m";   // a terminal escape from the file
// DEL and C1 are NOT covered by JSON.stringify, which is why the escaping helper
// is not just JSON.stringify. Mutation testing found that no fixture reached
// them: removing the DEL/C1 half of the pattern survived every check.
const HOSTILE_C1 = "a\u007fb\u009fc";
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
  ["refusal carrying DEL and C1", ws({ requests: [req({ id: `d${HOSTILE_C1}` })] }), {}, "hostile"],
  ["success path with hostile variable value", ws({ variables: { v: HOSTILE }, requests: [req({ url: "https://a.example/?q={{v}}" })] }), {}, "hostile"],
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
// C0 controls except tab and newline, DEL, and C1.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const carriesControl = (out) => CONTROL.test(out);

// --- channels ---------------------------------------------------------------

function channels(fixture, env, extraArg) {
  const file = join(dir, "w.json");
  writeFileSync(file, typeof fixture === "string" ? fixture : JSON.stringify(fixture));
  const args = extraArg ? ["--request", extraArg] : [];
  const run = (extra) => {
    try {
      const stdout = execFileSync(process.execPath, [bin, "resolve", file, ...args, ...extra],
        { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return stdout;
    } catch (e) { return (e.stdout ?? "") + (e.stderr ?? ""); }
  };

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

for (const [name, fixture, env, kind, extraArg] of FIXTURES) {
  const ch = channels(fixture, env, extraArg);
  ch.api = await apiChannel(fixture, env, extraArg);

  const hit = [];
  for (const [label, out] of Object.entries(ch)) {
    if (label === "file") continue;
    if (kind === "secret" && carriesSecret(out)) hit.push(`${label}:SECRET`);
    // Terminal escapes matter on the human channel; the others are consumed by
    // machines, where a control character is data rather than a command.
    if (label === "human" && carriesControl(out)) hit.push(`${label}:CONTROL`);
  }

  const verdict = hit.length ? "LEAK " : "clean";
  console.log(`  ${verdict} ${name.padEnd(42)} ${hit.join(" ")}`);
  if (hit.length) findings.push({ name, hit });
}

console.log(`\n  ${findings.length} of ${FIXTURES.length} fixtures leak`);
const secretPaths = findings.filter((f) => f.hit.some((h) => h.endsWith("SECRET")));
const controlPaths = findings.filter((f) => f.hit.some((h) => h.endsWith("CONTROL")));
console.log(`  secret disclosure:      ${secretPaths.length} paths`);
console.log(`  terminal escape:        ${controlPaths.length} paths`);
console.log(`  DOM channel:            NOT REACHED — the UI renders nothing on a refusal`);

if (FIXTURES.length !== EXPECTED_FIXTURES) {
  console.error(`\n  FAIL count tripwire: ${FIXTURES.length} fixtures, expected ${EXPECTED_FIXTURES}`);
  process.exit(2);
}
process.exit(findings.length ? 1 : 0);
