// `run` OVER HTTPS, END TO END THROUGH THE REAL BINARY.
// HTTPS-PREREGISTRATION §3, increment 4.
//
// `test/wire-tls.mjs` checks the transport. These rows check what a user gets:
// `bin/reqtrail.js run`, a workspace file on disk, exit codes, and the printed
// and `--json` results. They are the rows that make "code 3 means bytes were
// attempted" and P-VERIFY claims about the CLI rather than about a module.
//
// Every binary runs with an explicit, minimal environment — PATH, plus exactly
// the variable the row is about — never `process.env`. Trust in the test-only
// certificate comes ONLY from `NODE_EXTRA_CA_CERTS` (D1).
//
// The receiver runs in THIS process, so the binary is started asynchronously.
// A synchronous spawn would block the event loop the receiver needs to accept
// the connection.
//
// NOT CHECKED HERE, AND RECORDED: with NODE_TLS_REJECT_UNAUTHORIZED=0 set, Node
// prints its own stderr warning that certificate verification is disabled.
// Under reqtrail that warning is false — the row below proves verification
// still happens. It is Node's text, on stderr, and it is not asserted either
// way.

import { execFile } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startTlsReceiver, TEST_CERT_PATH } from "./tls-receiver.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "bin", "reqtrail.js");

let passed = 0;
const failures = [];
const check = (name, fn) => {
  passed++;
  try { if (fn() !== true) failures.push(name); }
  catch (e) { failures.push(`${name}: threw ${e.message}`); }
};

const reqtrail = (args, extraEnv) => new Promise((resolve) => {
  execFile(process.execPath, [bin, ...args],
    { env: { PATH: process.env.PATH, ...extraEnv }, encoding: "utf8", timeout: 20000 },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
});
const TRUSTED = { NODE_EXTRA_CA_CERTS: TEST_CERT_PATH };
// A refusal or crash prints nothing parseable on stdout. That must fail the
// named rows below, not crash the file before they run.
const parse = (text) => { try { return JSON.parse(text); } catch { return {}; } };

const r = await startTlsReceiver();
const dir = mkdtempSync(join(tmpdir(), "reqtrail-run-tls-"));
const workspace = (host) => {
  const path = join(dir, `${host}.json`);
  writeFileSync(path, JSON.stringify({ version: 1, variables: {},
    requests: [{ id: "r", name: "n", method: "GET", url: `https://${host}:${r.port}/p`,
      headers: [{ name: "X-A", value: "1" }] }] }));
  return path;
};
const good = workspace("localhost");
const wrongHost = workspace("127.0.0.1");   // the certificate names localhost only

try {
  // ---- trusted: the send completes -----------------------------------------
  let before = r.captures.length;
  const ok = await reqtrail(["run", good], TRUSTED);
  check("run https, trusted certificate, exits 0", () => ok.code === 0);
  check("run https, trusted: the request reached the server", () =>
    r.captures.length === before + 1);

  const okJson = await reqtrail(["run", good, "--json"], TRUSTED);
  const okDoc = parse(okJson.stdout);
  check("run https --json, trusted: sent, with the server's status", () =>
    okDoc.sent === true && okDoc.response?.status === 200);

  // ---- untrusted: exit 3, nothing delivered --------------------------------
  before = r.captures.length;
  const bad = await reqtrail(["run", good], {});
  check("run https, untrusted certificate, exits 3", () => bad.code === 3);
  check("run https, untrusted: prints the code, not a message", () =>
    bad.stdout.trimEnd().endsWith("not sent: DEPTH_ZERO_SELF_SIGNED_CERT"));
  check("run https, untrusted: the request is still shown — the diagnosis is not withheld", () =>
    bad.stdout.startsWith(`GET https://localhost:${r.port}/p`));
  check("run https, untrusted: NO request bytes reached the server", () =>
    r.captures.length === before);

  const badJson = await reqtrail(["run", good, "--json"], {});
  const badDoc = parse(badJson.stdout);
  check("run https --json, untrusted: not sent, with a transport code", () =>
    badJson.code === 3 && badDoc.sent === false &&
    badDoc.transport?.code === "DEPTH_ZERO_SELF_SIGNED_CERT");

  // ---- wrong host: exit 3, nothing delivered -------------------------------
  before = r.captures.length;
  const alt = await reqtrail(["run", wrongHost], TRUSTED);
  check("run https, certificate for a different host, exits 3", () =>
    alt.code === 3 && alt.stdout.trimEnd().endsWith("not sent: ERR_TLS_CERT_ALTNAME_INVALID"));
  check("run https, wrong host: NO request bytes reached the server", () =>
    r.captures.length === before);

  // ---- P-VERIFY: the environment cannot turn verification off --------------
  before = r.captures.length;
  const env0 = await reqtrail(["run", good], { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  check("run https, untrusted with NODE_TLS_REJECT_UNAUTHORIZED=0, still exits 3", () =>
    env0.code === 3 && env0.stdout.trimEnd().endsWith("not sent: DEPTH_ZERO_SELF_SIGNED_CERT"));
  check("run https, NODE_TLS_REJECT_UNAUTHORIZED=0: still NO request bytes", () =>
    r.captures.length === before);
} finally {
  r.close();
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`FAIL ${failures.length} of ${passed}`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`run-tls ${passed}/${passed} OK`);
