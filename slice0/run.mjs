import { startReceiver, parseCapture } from "./receiver.mjs";
import { prepare, Refused } from "./prepare.mjs";

const results = [];
const rec = (id, note, ok, detail) => results.push({ id, note, ok, detail });

import http from "node:http";
// TRANSPORT: node:http, not fetch. fetch/Headers COLLAPSES duplicate header
// names into one comma-joined value and injects accept, accept-encoding,
// user-agent and sec-fetch-mode. Both make the canonical model unrepresentable.
async function send(prepared) {
  const m = prepared.materialize();
  const u = new URL(m.url);
  const headers = {};
  for (const x of m.headers) {
    if (x.name in headers) headers[x.name] = [].concat(headers[x.name], x.value);
    else headers[x.name] = x.value;
  }
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
// PREDICTED, not observed. P8 named these five; node:http adds two, so this
// assertion FAILS and that failure is the recorded result. Do not "fix" it to
// match reality — editing an assertion to fit an outcome is what this project
// exists not to do. See SLICE-0-EVIDENCE.md, conduct note on P8.
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
