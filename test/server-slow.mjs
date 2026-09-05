// The two timeout rows, measured with the SHIPPED values.
//
// Split from test/server.mjs by COST, not by importance. Each takes five
// seconds by construction, and test/server.mjs is run sixteen times by the
// mutation pass — so leaving them there made a full pass take about nine
// minutes, which is how a mutation pass stops being run. Nothing here is
// weakened to be fast: the alternative was configuring shorter timeouts, and
// the stalled-header case has already shown once that a timeout altered after
// listen() is silently not in effect, so a check that appeared to pass proved
// nothing.
//
// Two different mechanisms, which is why both exist: the header deadline is
// node's `headersTimeout`, enforced by a poller; the body deadline is ours, in
// readBody.

import net from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createUiServer, newToken, LIMITS } from "../src/server/server.js";

const EXPECTED = 2;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "examples", "example.reqtrail.json");
const text = readFileSync(file, "utf8");
const ENV = { API_TOKEN: "s3cr3t-value-1234" };
const token = newToken();
const assets = new Map();

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

await check("row 4 — a stalled header block is closed, not held", async () => {
  // MEASURED, using the shipped values deliberately. Setting headersTimeout
  // AFTER listen() to make this check fast does not work — the connection
  // tracker does not pick the new value up, and the check then passes or fails
  // for a reason unrelated to the row. That cost a wrong reading once already:
  // an early version appeared to pass and was not reproducible. Five seconds is
  // the price of testing the thing that ships.
  const slow = createUiServer({ text, file, token, assets, env: ENV });
  const p = await slow.listen();
  const r = await new Promise((resolve) => {
    const s = net.connect(p, "127.0.0.1", () => s.write("GET / HTTP/1.1\r\n"));
    let data = "";
    s.on("data", (c) => { data += c; });
    s.on("close", () => resolve({ closed: true, data }));
    setTimeout(() => { s.destroy(); resolve({ closed: false, data }); },
      LIMITS.headersTimeoutMs + 3000);
  });
  await slow.close();
  return r.closed && r.data.includes("408");
});

await check("row 4 — a stalled request BODY is closed, not held", async () => {
  const slow = createUiServer({ text, file, token, assets, env: ENV });
  const p = await slow.listen();
  const r = await new Promise((resolve) => {
    const s = net.connect(p, "127.0.0.1", () => {
      // Complete headers promising a body, then send one byte and stop.
      s.write(`POST /api/session HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\n` +
        `Origin: http://127.0.0.1:${p}\r\nAuthorization: Bearer ${token}\r\n` +
        `Content-Type: application/json\r\nContent-Length: 5000\r\n\r\n{`);
    });
    let data = "";
    s.on("data", (c) => { data += c; });
    s.on("close", () => resolve({ closed: true, data }));
    setTimeout(() => { s.destroy(); resolve({ closed: false, data }); },
      LIMITS.bodyReadTimeoutMs + 3000);
  });
  await slow.close();
  return r.data.includes("408");
});

if (failures.length) {
  console.error(`FAIL ${failures.length} of ${ran}`);
  for (const f of failures) console.error("  " + f);
}
if (ran !== EXPECTED) {
  console.error(`FAIL count tripwire: ran ${ran} checks, expected ${EXPECTED}`);
  process.exit(1);
}
if (failures.length) process.exit(1);
console.log(`server-slow ${ran}/${EXPECTED} OK   (shipped timeout values)`);
