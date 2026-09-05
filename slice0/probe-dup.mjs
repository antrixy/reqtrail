import http from "node:http";
import { startReceiver, parseCapture } from "./receiver.mjs";
const r = await startReceiver();

// node:http with a repeated-name array — the lower-level path.
await new Promise((res) => {
  const req = http.request({ host:"127.0.0.1", port:r.port, path:"/x", method:"GET",
    headers: { "X-Tag": ["alpha","beta"], "Authorization":"Bearer x", "X-Empty":"" } });
  req.on("response", (s)=>{ s.resume(); s.on("end",res); });
  req.on("error",res); req.end();
});
const c = parseCapture(r.captures[0]);
console.log("node:http  ->", JSON.stringify(c.headers.map(h=>`${h.name}: ${h.value}`), null, 0));
console.log("  duplicate X-Tag occurrences:", c.headers.filter(h=>h.name.toLowerCase()==="x-tag").length);
console.log("  runtime-added:", c.headers.map(h=>h.name.toLowerCase())
   .filter(n=>!["x-tag","authorization","x-empty"].includes(n)).sort().join(","));
r.close();
