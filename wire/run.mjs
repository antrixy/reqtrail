// LIVE rig — the repaired send side. NOT frozen. See ./README.md.
//
// The receiver is imported from ../slice0/ UNCHANGED. It was correct from the
// start (raw-socket, verbatim bytes) and the freeze over it still holds; this
// file reads those bytes, it does not edit them. prepare.mjs is likewise
// imported, not copied — it remains the crude non-product builder until the
// transport adapter exists and the product core replaces it.
import http from "node:http";
import { startReceiver, parseCapture } from "../slice0/receiver.mjs";
import { prepare } from "../slice0/prepare.mjs";

const results = [];
const rec = (id, note, ok, detail) => results.push({ id, note, ok, detail });

// THE REPAIR. slice0/run.mjs:14-17 collapsed the ordered array into an object.
// node:http accepts a FLAT ARRAY [name, value, name, value, ...] and writes it
// in the given order, preserving repeated names, interleaving and name casing.
// It also stops supplying Host — see W3. Whoever sends must now write it.
function send(ordered, u, method) {
  const flat = [];
  for (const h of ordered) flat.push(h.name, h.value);
  return new Promise((res, rej) => {
    const req = http.request({ host: u.hostname, port: u.port,
      path: u.pathname + u.search, method, headers: flat });
    req.on("response", (s) => { s.resume(); s.on("end", res); });
    req.on("error", rej); req.end();
  });
}

const r = await startReceiver();
const base = `http://127.0.0.1:${r.port}`;
const ENV = { API_TOKEN: "s3cr3t-value", EMPTY: "" };

// ---- slice-0's base fixture, unchanged --------------------------------------
const p1 = prepare(
  { method: "GET", url: "{{baseUrl}}/users/{{userId}}?q={{query}}",
    headers: [ { name: "Authorization", value: "Bearer {{$env.API_TOKEN}}" },
               { name: "X-Tag", value: "alpha" },
               { name: "X-Tag", value: "beta" },
               { name: "X-Empty", value: "" },
               { name: "Accept-Language", value: "en" } ] },
  { baseUrl: base, userId: "42", query: "a b" }, ENV);

let before = r.captures.length;
const m1 = p1.materialize();
await send(m1.headers, new URL(m1.url), m1.method);
const cap = parseCapture(r.captures[before]);
const disp = p1.render();

const target = new URL(disp.url).pathname + new URL(disp.url).search;
rec("P1", "method+URL match capture", cap.method === "GET" && cap.target === target,
    `displayed ${target} | captured ${cap.target}`);

const tags = cap.headers.filter(h => h.name.toLowerCase() === "x-tag").map(h => h.value);
rec("P2", "duplicates survive in order", tags.length === 2 && tags[0] === "alpha" && tags[1] === "beta",
    JSON.stringify(tags));

const empty = cap.headers.filter(h => h.name.toLowerCase() === "x-empty");
rec("P3", "empty header transmitted", empty.length === 1 && empty[0].value === "",
    JSON.stringify(empty));

const authName = cap.headers.find(h => h.name.toLowerCase() === "authorization")?.name;
rec("P4", "casing preserved on the wire", authName === "Authorization",
    `sent "Authorization" | captured "${authName}"`);

const userSet = new Set(["authorization","x-tag","x-empty","accept-language"]);
const added = cap.headers.map(h => h.name.toLowerCase()).filter(n => !userSet.has(n)).sort();
rec("P8", "runtime adds Connection only", JSON.stringify(added) === JSON.stringify(["connection"]),
    JSON.stringify(added));

rec("P10", "no secret in displayed output", !JSON.stringify(disp).includes("s3cr3t-value"),
    "checked render()");

const names = cap.headers.map(h => h.name.toLowerCase());
const idx = n => names.indexOf(n);
rec("P14", "order across distinct names preserved",
    idx("authorization") < idx("x-tag") && idx("x-tag") < idx("accept-language"),
    names.join(","));

// ---- W rows: what the object collapse could not express ---------------------
// These fixtures do not exist in slice 0. The base fixture's two X-Tag entries
// are ADJACENT and identically cased, which is why the collapse passed P2.

const p2 = prepare(
  { method: "GET", url: "{{baseUrl}}/w",
    headers: [ { name: "X-Tag",   value: "alpha" },
               { name: "X-Other", value: "mid" },
               { name: "X-Tag",   value: "beta" },
               { name: "x-tag",   value: "gamma" } ] },
  { baseUrl: base }, ENV);

before = r.captures.length;
const m2 = p2.materialize();
await send(m2.headers, new URL(m2.url), m2.method);
const c2 = parseCapture(r.captures[before]);
const seq = c2.headers.filter(h => !["host","connection"].includes(h.name.toLowerCase()))
                      .map(h => `${h.name}: ${h.value}`);

rec("W1", "interleaving across repeated and distinct names preserved",
    JSON.stringify(seq) === JSON.stringify(
      ["X-Tag: alpha","X-Other: mid","X-Tag: beta","x-tag: gamma"]),
    JSON.stringify(seq));

rec("W2", "every occurrence reaches the wire — none dropped",
    c2.headers.filter(h => h.name.toLowerCase() === "x-tag").length === 3,
    `x-tag occurrences: ${c2.headers.filter(h => h.name.toLowerCase() === "x-tag").length}`);

// W3 is a RECORDED MEASUREMENT, not a prediction that held. Host absence under
// the array form was measured in a probe before this file was written, and it
// is written here to what was observed. Stated plainly rather than dressed as a
// prediction — see README.
const host = cap.headers.filter(h => h.name.toLowerCase() === "host");
rec("W3", "node:http supplies NO Host under array headers", host.length === 0,
    `Host occurrences: ${host.length}`);

r.close();
console.log(JSON.stringify(results, null, 1));
const bad = results.filter(x => !x.ok);
console.log(`\n${results.length - bad.length}/${results.length} pass` +
  (bad.length ? `  FAILING: ${bad.map(x => x.id).join(",")}` : ""));
