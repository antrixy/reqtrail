import { startReceiver, parseCapture } from "./receiver.mjs";
import { prepare, Refused } from "./prepare.mjs";

const results = [];
const rec = (id, note, ok, detail) => results.push({ id, note, ok, detail });

import http from "node:http";
// TRANSPORT: node:http, not fetch. fetch/Headers COLLAPSES duplicate header
// names into one comma-joined value and injects accept, accept-encoding,
// user-agent and sec-fetch-mode. Both make the canonical model unrepresentable.
//
// SEND SIDE REPAIRED 2026-09-08, and this is the ONLY behaviour change this
// file has taken since the 2026-09-04 run. It previously built an OBJECT from
// the ordered array, which is the harness doing to itself what it was written
// to catch fetch doing. node:http accepts a flat array and writes it in the
// given order. Full account, including what the object form silently deleted
// and which rows moved, in ../SLICE-0-EVIDENCE.md under "the send side was
// lossy". The 2026-09-04 tree is at 2876a83 if you want the original.
//
// NO ASSERTION IN THIS FILE WAS EDITED. P4 and P8 were falsified on 09-04 and
// are still falsified; the repair moved neither verdict.
async function send(prepared) {
  const m = prepared.materialize();
  const u = new URL(m.url);
  const headers = [];
  for (const x of m.headers) headers.push(x.name, x.value);
  return new Promise((res, rej) => {
    const req = http.request({ host: u.hostname, port: u.port,
      path: u.pathname + u.search, method: m.method, headers });
    req.on("response", (s) => { s.resume(); s.on("end", res); });
    req.on("error", rej); req.end();
  });
}

const r = await startReceiver();
const base = `http://127.0.0.1:${r.port}`;
const ENV = { API_TOKEN: "s3cr3t-value", EMPTY: "" };

// ---- base fixture -----------------------------------------------------------
const p1 = prepare(
  { method: "GET", url: "{{baseUrl}}/users/{{userId}}?q={{query}}",
    headers: [ { name: "Authorization", value: "Bearer {{$env.API_TOKEN}}" },
               { name: "X-Tag", value: "alpha" },
               { name: "X-Tag", value: "beta" },
               { name: "X-Empty", value: "" },
               { name: "Accept-Language", value: "en" } ] },
  { baseUrl: base, userId: "42", query: "a b" }, ENV);

const before = r.captures.length;
await send(p1);
const cap = parseCapture(r.captures[before]);
const disp = p1.render();

// P1 method + target
const target = new URL(disp.url).pathname + new URL(disp.url).search;
rec("P1", "method+URL match capture", cap.method === "GET" && cap.target === target,
    `displayed ${target} | captured ${cap.target}`);

// P2 duplicate headers
const tags = cap.headers.filter(h => h.name.toLowerCase() === "x-tag").map(h => h.value);
rec("P2", "duplicates survive in order", tags.length === 2 && tags[0] === "alpha" && tags[1] === "beta",
    JSON.stringify(tags));

// P3 empty header value
const empty = cap.headers.filter(h => h.name.toLowerCase() === "x-empty");
rec("P3", "empty header transmitted", empty.length === 1 && empty[0].value === "",
    JSON.stringify(empty));

// P4 header name casing on the wire
const authName = cap.headers.find(h => h.name.toLowerCase() === "authorization")?.name;
rec("P4", "names lowercased on the wire", authName === "authorization",
    `sent "Authorization" | captured "${authName}"`);

// P8 runtime-added headers
const userSet = new Set(["authorization","x-tag","x-empty","accept-language"]);
const added = cap.headers.map(h => h.name.toLowerCase()).filter(n => !userSet.has(n)).sort();
// PREDICTED, not observed. P8 named these five; node:http adds ONE under the
// repaired send side — Connection. On 09-04, through the object form, it added
// two: Host and Connection. The array form supplies no Host, which is a real
// finding and not a harness artifact; see ../SLICE-0-EVIDENCE.md.
// Either way this assertion FAILS and that failure is the recorded result. Do
// not "fix" it to match reality — editing an assertion to fit an outcome is
// what this project exists not to do. See SLICE-0-EVIDENCE.md, conduct note
// on P8.
const expected = ["accept","accept-encoding","connection","host","user-agent"].sort();
rec("P8", "runtime adds exactly the documented five",
    JSON.stringify(added) === JSON.stringify(expected), JSON.stringify(added));

// P10 secret never in reqtrail-generated output
rec("P10", "no secret in displayed output", !JSON.stringify(disp).includes("s3cr3t-value"),
    "checked render()");

// P14 order across distinct names
const names = cap.headers.map(h => h.name.toLowerCase());
const idx = n => names.indexOf(n);
rec("P14", "order across distinct names preserved",
    idx("authorization") < idx("x-tag") && idx("x-tag") < idx("accept-language"),
    names.join(","));

r.close();
console.log(JSON.stringify(results, null, 1));
