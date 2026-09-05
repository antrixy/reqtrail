// PARITY. The CLI adapter and the loopback server adapter must produce
// byte-identical output from the same input.
//
// This is a row, not a nicety. It is the only way to know that no logic leaked
// into an adapter: comparing two renderings of the same core result is a
// property, whereas "the adapters own no logic" is an intention. It is built
// now, before the React app exists, because retrofitting it after the two sides
// have diverged means discovering the boundary already leaked.
//
// It compares the ADAPTERS' OUTPUT BYTES, not two calls to the same function.
// A comparison of `resolveWorkspace(...)` against `resolveWorkspace(...)` would
// pass by construction and prove nothing.
//
// FIRST RUN: FAILED, as pre-registered prediction P10 expected. Two fixtures
// disagreed on every masked secret, because the CLI subprocess was given
// API_TOKEN and the server read the test process's own environment. THE
// ENVIRONMENT IS PART OF THE INPUT, and the harness was supplying two different
// inputs — the same class of mistake as slice 0's near-miss, where the harness
// rather than the target was the thing that differed. It also showed the server
// adapter reading ambient process state inside a request handler, which is now
// passed in once per session instead. Both were fixed; the prediction stands as
// written.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createUiServer, newToken } from "../src/server/server.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "bin", "reqtrail.js");

const ENV = { PATH: process.env.PATH, API_TOKEN: "s3cr3t-value-1234" };

const dir = mkdtempSync(join(tmpdir(), "reqtrail-parity-"));
const write = (name, obj) => {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
};

const FIXTURES = [
  ["the example workspace", join(root, "examples", "example.reqtrail.json"), "get-user"],
  ["a second request in the same file",
    join(root, "examples", "example.reqtrail.json"), "list-users"],
  ["normalization in every component", write("norm.json", {
    version: 1,
    variables: { b: "https://API.Example.COM:443", p: "a b", q: "café", d: "/x/../y" },
    requests: [{ id: "r", method: "GET", url: "{{b}}/{{p}}{{d}}?q={{q}}#frag",
      headers: [{ name: "X-Tag", value: "alpha" }, { name: "X-Tag", value: "alpha" },
                { name: "X-Empty", value: "" }] }],
  }), "r"],
  ["a secret in the URL and a header", write("secret.json", {
    version: 1,
    variables: { b: "https://a.example" },
    requests: [{ id: "r", method: "GET", url: "{{b}}/x?k={{$env.API_TOKEN}}",
      headers: [{ name: "Authorization", value: "Bearer {{$env.API_TOKEN}}" }] }],
  }), "r"],
  ["an unresolved reference", write("unresolved.json", {
    version: 1,
    requests: [{ id: "r", method: "GET", url: "https://a.example/x",
      headers: [{ name: "A", value: "{{$env.NOT_SET_ANYWHERE}}" }] }],
  }), "r"],
  ["a refusal", write("refused.json", {
    version: 1,
    requests: [{ id: "r", method: "GET", url: "https://a.example/{{ x }}" }],
  }), "r"],
  ["an unknown request id", join(root, "examples", "example.reqtrail.json"), "no-such-id"],
];

const token = newToken();
let failures = 0;
let compared = 0;

for (const [name, file, requestId] of FIXTURES) {
  const text = readFileSync(file, "utf8");
  const ui = createUiServer({ text, file, token, assets: new Map(), env: ENV });
  const port = await ui.listen();

  // The CLI adapter, as a user runs it.
  let cli;
  try {
    cli = execFileSync(process.execPath,
      [bin, "resolve", file, "--request", requestId, "--json"],
      { env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // A refusal writes its JSON to stderr and nothing to stdout.
    cli = e.stdout === "" ? e.stderr : e.stdout;
  }

  // The server adapter, as the browser calls it.
  const res = await fetch(`http://127.0.0.1:${port}/api/resolve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({ requestId }),
  });
  const srv = await res.text();
  await ui.close();

  compared++;
  const a = Buffer.from(cli);
  const b = Buffer.from(srv);
  if (a.equals(b)) continue;

  failures++;
  console.error(`PARITY FAIL — ${name}`);
  const al = cli.split("\n"), bl = srv.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      console.error(`  line ${i + 1}`);
      console.error(`    cli:    ${JSON.stringify(al[i])}`);
      console.error(`    server: ${JSON.stringify(bl[i])}`);
      break;
    }
  }
}

rmSync(dir, { recursive: true, force: true });

if (failures) {
  console.error(`parity: ${failures} of ${compared} fixtures disagree`);
  process.exit(1);
}
console.log(`parity ${compared}/${compared} byte-identical`);
