// The disambiguation probe for the SEND side, in the role slice0/probe-dup.mjs
// played for the transport: it separates "node:http cannot" from "the harness
// cannot". Sends ONE ordered array two ways against the same frozen receiver.
import http from "node:http";
import { startReceiver, parseCapture } from "./receiver.mjs";
const r = await startReceiver();

const ordered = [
  { name: "X-Tag",   value: "alpha" },
  { name: "X-Other", value: "mid" },
  { name: "X-Tag",   value: "beta" },
  { name: "x-tag",   value: "gamma" },
];

const send = (headers) => {
  const n = r.captures.length;
  return new Promise((res, rej) => {
    const q = http.request({ host: "127.0.0.1", port: r.port, path: "/x", method: "GET", headers });
    q.on("response", (s) => { s.resume(); s.on("end", () => res(r.captures[n])); });
    q.on("error", rej); q.end();
  });
};

// A — slice0/run.mjs:14-17, verbatim
const obj = {};
for (const x of ordered) {
  if (x.name in obj) obj[x.name] = [].concat(obj[x.name], x.value);
  else obj[x.name] = x.value;
}
const A = parseCapture(await send(obj)).headers;
// B — the flat array
const B = parseCapture(await send(ordered.flatMap(x => [x.name, x.value]))).headers;
r.close();

const fmt = (hs) => hs.filter(h => !["host","connection"].includes(h.name.toLowerCase()))
                      .map(h => `${h.name}: ${h.value}`);
console.log("sent (ordered array)   ", JSON.stringify(ordered.map(h => `${h.name}: ${h.value}`)));
console.log("A object collapse      ", JSON.stringify(fmt(A)));
console.log("B flat array           ", JSON.stringify(fmt(B)));
console.log(`\noccurrences sent 4 | A captured ${fmt(A).length} | B captured ${fmt(B).length}`);
