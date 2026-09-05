import http from "node:http";
import { startReceiver, parseCapture } from "./receiver.mjs";
import { prepare, Refused } from "./prepare.mjs";
const r = await startReceiver();
const base = `http://127.0.0.1:${r.port}`;
const ENV = { API_TOKEN: "s3cr3t-value", EMPTY: "" };

async function send(p) {
  const m = p.materialize(); const u = new URL(m.url); const headers = {};
  for (const x of m.headers) headers[x.name] = x.name in headers ? [].concat(headers[x.name], x.value) : x.value;
  return new Promise((res, rej) => { const q = http.request({ host:u.hostname, port:u.port,
    path:u.pathname+u.search, method:m.method, headers });
    q.on("response", s=>{s.resume();s.on("end",res);}); q.on("error",rej); q.end(); });
}

async function trial(name, req, vars, env = ENV) {
  const n = r.captures.length;
  try {
    const p = prepare(req, vars, env);
    await send(p);
    const c = parseCapture(r.captures[n]);
    const d = p.render(); const t = new URL(d.url);
    const match = c.target === t.pathname + t.search;
    console.log(`${name.padEnd(22)} SENT   display=${(t.pathname+t.search).slice(0,42).padEnd(42)} capture=${c.target.slice(0,42).padEnd(42)} ${match?"MATCH":"*** DIFFER ***"}`);
    return { name, sent: true, match, display: t.pathname+t.search, capture: c.target };
  } catch (e) {
    const refused = e instanceof Refused;
    console.log(`${name.padEnd(22)} ${refused?"REFUSED":"ERROR  "} ${refused?`[${e.code}] ${e.path}: ${e.message}`:e.message.slice(0,60)}   sentBytes=${r.captures.length>n}`);
    return { name, sent: false, refused, msg: e.message, reachedWire: r.captures.length > n };
  }
}

const V = (q) => ({ baseUrl: base, q });
const out = [];
out.push(await trial("space in query",   {method:"GET",url:"{{baseUrl}}/x?q={{q}}",headers:[]}, V("a b")));
out.push(await trial("quote+backtick",   {method:"GET",url:"{{baseUrl}}/x?q={{q}}",headers:[]}, V("a'\"`b")));
out.push(await trial("dollar+backslash", {method:"GET",url:"{{baseUrl}}/x?q={{q}}",headers:[]}, V("a$b\\c")));
out.push(await trial("non-ASCII path",   {method:"GET",url:"{{baseUrl}}/{{q}}",headers:[]},     V("café")));
out.push(await trial("percent literal",  {method:"GET",url:"{{baseUrl}}/{{q}}",headers:[]},     V("100%")));
out.push(await trial("dot segments",     {method:"GET",url:"{{baseUrl}}/a/../b",headers:[]},    V("")));
out.push(await trial("trailing slash",   {method:"GET",url:"{{baseUrl}}/a/",headers:[]},        V("")));
out.push(await trial("fragment",         {method:"GET",url:"{{baseUrl}}/a#frag",headers:[]},    V("")));
out.push(await trial("CRLF in header",   {method:"GET",url:"{{baseUrl}}/x",headers:[{name:"X-H",value:"{{q}}"}]}, V("ok\r\nX-Evil: 1")));
out.push(await trial("NUL in header",    {method:"GET",url:"{{baseUrl}}/x",headers:[{name:"X-H",value:"{{q}}"}]}, V("ok\u0000bad")));
out.push(await trial("missing env",      {method:"GET",url:"{{baseUrl}}/x",headers:[{name:"A",value:"{{$env.NOPE}}"}]}, V("")));
out.push(await trial("set-but-empty env",{method:"GET",url:"{{baseUrl}}/x",headers:[{name:"A",value:"{{$env.EMPTY}}"}]}, V("")));
out.push(await trial("nested template",  {method:"GET",url:"{{baseUrl}}/{{q}}",headers:[]},     V("{{inner}}")));
out.push(await trial("unmatched braces", {method:"GET",url:"{{baseUrl}}/{{q",headers:[]},       V("")));
out.push(await trial("whitespace in ref",{method:"GET",url:"{{baseUrl}}/{{ q }}",headers:[]},   V("")));
out.push(await trial("undefined var",    {method:"GET",url:"{{baseUrl}}/{{nope}}",headers:[]},  V("")));

r.close();
const sent = out.filter(o=>o.sent);
console.log(`\nsent ${sent.length}, all display==capture: ${sent.every(o=>o.match)}`);
console.log(`refused ${out.filter(o=>o.refused).length}, any refusal reached the wire: ${out.some(o=>o.reachedWire)}`);
