// reqtrail selftest. A check that cannot report failure is not a check, so the
// count is asserted at the end: adding a check without updating EXPECTED fails
// the run, and so does a check that silently stops executing.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveWorkspace, __prepareForTest } from "../src/core/prepare.js";
import { project } from "../src/core/exact.js";
import { parseWorkspace, selectRequest } from "../src/core/parse.js";
import { Refusal } from "../src/core/errors.js";
import { renderResolve } from "../src/cli/render.js";

const EXPECTED = 199;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "bin", "reqtrail.js");

let passed = 0;
const failures = [];
function check(name, fn) {
  passed++;
  try {
    const r = fn();
    if (r !== true) throw new Error(`returned ${JSON.stringify(r)}, wanted true`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

const ws = (o) => JSON.stringify({ version: 1, ...o });
const one = (url, headers = [], variables = {}) =>
  ws({ variables, requests: [{ id: "r", method: "GET", url, headers }] });

const go = (text, env = {}, requestId) =>
  resolveWorkspace(text, { env, requestId, source: "t.json" });

// Returns the Refusal detail, or throws if the call did NOT refuse.
function refusal(fn) {
  try {
    fn();
  } catch (e) {
    if (e instanceof Refusal) return e.detail;
    throw new Error(`threw ${e.name}, not a Refusal: ${e.message}`);
  }
  throw new Error("did not refuse");
}

const run = (args, env = {}) => {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...args],
      { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

// ---------------------------------------------------------------- schema ----

check("version missing refuses", () =>
  refusal(() => go(JSON.stringify({ requests: [] }))).code === "schema.version.missing");
check("version 2 refuses", () =>
  refusal(() => go(JSON.stringify({ version: 2, requests: [] }))).code === "schema.version.unknown");
check("version as string refuses", () =>
  refusal(() => go(JSON.stringify({ version: "1", requests: [] }))).code === "schema.version.unknown");
check("version refusal names the field path", () =>
  refusal(() => go(JSON.stringify({ version: 9, requests: [] }))).path === "version");
check("invalid JSON refuses", () =>
  refusal(() => go("{oops")).code === "schema.json");
check("root array refuses", () =>
  refusal(() => go("[]")).code === "schema.type");
check("unknown root key refuses", () =>
  refusal(() => go(ws({ requests: [], oops: 1 }))).code === "schema.unknown-key");
check("unknown request key refuses", () =>
  refusal(() => go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example", secret: true }] })))
    .code === "schema.unknown-key");
check("unknown header key refuses", () =>
  refusal(() => go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example",
    headers: [{ name: "a", value: "b", encode: true }] }] }))).code === "schema.unknown-key");
check("requests missing refuses", () =>
  refusal(() => go(ws({}))).code === "schema.type");
check("variables must be strings", () =>
  refusal(() => go(one("https://a.example", [], { n: 42 }))).code === "schema.type");
check("non-string variable names the path", () =>
  refusal(() => go(one("https://a.example", [], { n: 42 }))).path === "variables.n");
check("variables optional", () =>
  go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example" }] })).projection.method === "GET");
// WHAT THE WORKSPACE DECLARED, as distinct from what reqtrail derived.
//
// Ten checks below used to index `projection.headers` directly and pin its
// LENGTH. Adding the derived `Host` shifted every index by one and every count
// by one, and all ten went red at once — not because a property broke, but
// because each had pinned the array's shape on the day it was written. That is
// 9d, and one of them sits directly under a comment about 9d.
//
// Shifting the indices by one would have been the same defect with a new
// number. These select on `origin` instead, which is the property each check
// was actually defending: this VALUE is masked, these DUPLICATES survive, this
// CASING is preserved. A future derived header moves none of them.
const wh = (r) => r.projection.headers.filter((h) => h.origin === "workspace");

check("headers optional", () =>
  wh(go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example" }] }))).length === 0);
check("duplicate id refuses", () =>
  refusal(() => go(ws({ requests: [
    { id: "r", method: "GET", url: "https://a.example" },
    { id: "r", method: "GET", url: "https://b.example" }] }))).code === "schema.id.duplicate");
check("id charset enforced", () =>
  refusal(() => go(ws({ requests: [{ id: "a b", method: "GET", url: "https://a.example" }] })))
    .code === "schema.id.charset");
check("POST refused while there is no transport", () =>
  refusal(() => go(ws({ requests: [{ id: "r", method: "POST", url: "https://a.example" }] })))
    .code === "schema.method");
check("lowercase get refused", () =>
  refusal(() => go(ws({ requests: [{ id: "r", method: "get", url: "https://a.example" }] })))
    .code === "schema.method");
check("method refusal names the path", () =>
  refusal(() => go(ws({ requests: [{ id: "r", method: "PUT", url: "https://a.example" }] })))
    .path === "requests[0].method");
check("headers as object refuses", () =>
  refusal(() => go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example",
    headers: { a: "b" } }] }))).code === "schema.type");
check("invalid header name refuses", () =>
  refusal(() => go(one("https://a.example", [{ name: "bad name", value: "v" }])))
    .code === "schema.header.name");
check("template in header name refuses", () =>
  refusal(() => go(one("https://a.example", [{ name: "{{x}}", value: "v" }])))
    .code === "schema.header.name");
check("empty url refuses", () =>
  refusal(() => go(one(""))).code === "schema.type");
check("name is optional and kept", () =>
  go(ws({ requests: [{ id: "r", name: "N", method: "GET", url: "https://a.example" }] }))
    .request.name === "N");
check("name absent becomes null", () => go(one("https://a.example")).request.name === null);

// JSON is last-wins by specification, so two files that behave differently
// parse identically and nothing says so. Same argument as duplicate request ids.
check("a duplicate member at the root refuses", () =>
  refusal(() => go('{"version":1,"version":2,"requests":[]}')).code
    === "schema.duplicate-member");
check("a duplicate inside an array element names the index", () =>
  refusal(() => go('{"version":1,"requests":[{"id":"r","method":"GET","url":"a","url":"b"}]}'))
    .path === "requests[0].url");
check("the second array element is named correctly", () =>
  refusal(() => go('{"version":1,"requests":[{"id":"a","method":"GET","url":"x"},' +
    '{"id":"b","method":"GET","url":"y","url":"z"}]}')).path === "requests[1].url");
check("a duplicate deep inside headers names the full path", () =>
  refusal(() => go('{"version":1,"requests":[{"id":"r","method":"GET","url":"u",' +
    '"headers":[{"name":"A","value":"1"},{"name":"B","value":"1","value":"2"}]}]}'))
    .path === "requests[0].headers[1].value");
check("a duplicate in a nested object refuses", () =>
  refusal(() => go('{"version":1,"variables":{"a":"1","a":"2"},"requests":[]}')).path
    === "variables.a");
check("the same key at different depths is NOT a duplicate", () =>
  go('{"version":1,"variables":{"id":"x"},"requests":[{"id":"r","method":"GET",' +
    '"url":"https://a.example/"}]}').request.id === "r");
check("a brace inside a string value does not confuse the scanner", () =>
  refusal(() => go('{"version":1,"requests":[{"id":"r","method":"GET","url":"u",' +
    '"headers":[{"name":"A","value":"{\\"b\\":1}"}]}],"variables":{"k":"v","k":"w"}}'))
    .path === "variables.k");
check("an escaped quote inside a key does not confuse the scanner", () =>
  refusal(() => go('{"version":1,"variables":{"a\\"b":"1","a\\"b":"2"},"requests":[]}'))
    .code === "schema.duplicate-member");

// A variable no {{...}} could name does nothing, and a file whose author
// believes otherwise is the surprise this product exists to remove.
check("an unreferenceable variable name refuses", () =>
  refusal(() => go(one("https://a.example", [], {}).replace('"variables":{}',
    '"variables":{"a b":"x"}'))).code === "schema.variable.charset");
check("the variable charset matches the grammar's", () =>
  go(one("https://a.example/{{a-b_1}}", [], { "a-b_1": "ok" })).projection.url
    === "https://a.example/ok");

// A stray `}}` is ordinary text, DELIBERATELY. `{{` can only open a template;
// `}}` closes any nested JSON object, and values here routinely contain JSON.
check("a stray }} is literal, not refused", () =>
  go(one("https://a.example", [{ name: "A", value: '{"a":{"b":1}}' }]))
    .projection.headers.filter((h) => h.origin === "workspace")[0].value === '{"a":{"b":1}}');
check("an unclosed {{ is still refused", () =>
  refusal(() => go(one("https://a.example/{{x"))).code === "grammar.unmatched");

// ------------------------------------------------------------- selection ----

check("empty requests refuses at selection", () =>
  refusal(() => go(ws({ requests: [] }))).code === "selection.none");
check("single request needs no --request", () =>
  go(one("https://a.example")).request.id === "r");
check("two requests without --request refuses", () =>
  refusal(() => go(ws({ requests: [
    { id: "a", method: "GET", url: "https://a.example" },
    { id: "b", method: "GET", url: "https://b.example" }] }))).code === "selection.ambiguous");
check("ambiguous refusal lists the ids", () =>
  refusal(() => go(ws({ requests: [
    { id: "alpha", method: "GET", url: "https://a.example" },
    { id: "beta", method: "GET", url: "https://b.example" }] })))
    .cause.includes("alpha, beta"));
check("unknown id refuses", () =>
  refusal(() => go(one("https://a.example"), {}, "nope")).code === "selection.unknown");
check("unknown id lists the ids", () =>
  refusal(() => go(one("https://a.example"), {}, "nope")).cause.includes("\"r\"") ||
  refusal(() => go(one("https://a.example"), {}, "nope")).cause.includes("ids: r"));
check("named id selects it", () =>
  go(ws({ requests: [
    { id: "a", method: "GET", url: "https://a.example" },
    { id: "b", method: "GET", url: "https://b.example" }] }), {}, "b").request.id === "b");

// --------------------------------------------------------------- grammar ----

check("unmatched open refuses", () =>
  refusal(() => go(one("https://a.example/{{x"))).code === "grammar.unmatched");
check("empty name refuses", () =>
  refusal(() => go(one("https://a.example/{{}}"))).code === "grammar.empty");
check("whitespace inside refuses", () =>
  refusal(() => go(one("https://a.example/{{ x }}", [], { x: "1" }))).code === "grammar.whitespace");
check("out-of-charset name refuses", () =>
  refusal(() => go(one("https://a.example/{{x.y}}"))).code === "grammar.charset");
check("bad env name refuses", () =>
  refusal(() => go(one("https://a.example/{{$env.9x}}"))).code === "grammar.charset");
check("names are case sensitive", () =>
  go(one("https://a.example/{{X}}", [], { X: "1", x: "2" })).projection.url.endsWith("/1"));
check("nested template in a variable refuses", () =>
  refusal(() => go(one("https://a.example/{{a}}", [], { a: "{{b}}", b: "z" })))
    .code === "grammar.nested");
check("nested refusal names the variable", () =>
  refusal(() => go(one("https://a.example/{{a}}", [], { a: "{{b}}" }))).variable === "a");
check("nested template in an env value refuses", () =>
  refusal(() => go(one("https://a.example/{{$env.A}}"), { A: "{{b}}" })).code === "grammar.nested");
check("grammar refusal names the header path", () =>
  refusal(() => go(one("https://a.example", [{ name: "a", value: "{{ x }}" }])))
    .path === "headers[0]");
check("literal braces are not templates", () =>
  go(one("https://a.example/x?j=%7B%22a%22%3A1%7D")).projection.url.includes("%7B%22a%22"));

// ------------------------------------------------------- url normalization ----

const url = (u, vars = {}, env = {}) => go(one(u, [], vars), env).projection.url;

check("space in path encodes", () => url("https://a.example/a b") === "https://a.example/a%20b");
check("space in query encodes", () => url("https://a.example/x?q=a b") === "https://a.example/x?q=a%20b");
check("non-ASCII path encodes", () => url("https://a.example/café") === "https://a.example/caf%C3%A9");
check("non-ASCII host punycodes", () => url("https://café.example/") === "https://xn--caf-dma.example/");
check("host lowercased", () => url("https://API.Example.COM/") === "https://api.example.com/");
check("default port dropped", () => url("https://a.example:443/x") === "https://a.example/x");
check("dot segments collapse", () => url("https://a.example/a/../b") === "https://a.example/b");
check("percent literal survives", () => url("https://a.example/100%") === "https://a.example/100%");
check("plus in query survives", () => url("https://a.example/x?q=a+b") === "https://a.example/x?q=a+b");
check("fragment dropped from the url", () =>
  url("https://a.example/a#frag") === "https://a.example/a");
check("fragment drop warns", () =>
  go(one("https://a.example/a#frag")).warnings.some((w) => w.code === "url.fragment"));
check("urlNormalized true when bytes changed", () =>
  go(one("https://a.example/a b")).urlNormalized === true);
check("urlNormalized false when unchanged", () =>
  go(one("https://a.example/a")).urlNormalized === false);
check("relative url refuses", () =>
  refusal(() => go(one("/users/1"))).code === "url.invalid");
check("file scheme refuses", () =>
  refusal(() => go(one("file:///etc/passwd"))).code === "url.scheme");
check("ftp scheme refuses", () =>
  refusal(() => go(one("ftp://a.example/x"))).code === "url.scheme");
check("url refusal names the path", () =>
  refusal(() => go(one("/users/1"))).path === "url");
check("a variable may supply the whole origin", () =>
  url("{{b}}/users", { b: "https://a.example" }) === "https://a.example/users");
check("a variable may supply the host alone", () =>
  url("https://{{h}}/x", { h: "a.example" }) === "https://a.example/x");

// P1 and P2 from PREREGISTRATION-0.1.0.md, measured rather than assumed.
check("P1 new URL accepts a literal template in the host", () => {
  try { new URL("https://{{host}}/a"); return true; } catch { return false; }
});
check("P2 braces encode in a path", () =>
  new URL("https://a.example/{{x}}").href === "https://a.example/%7B%7Bx%7D%7D");
check("P2 braces pass through a query", () =>
  new URL("https://a.example/?q={{x}}").href === "https://a.example/?q={{x}}");

// ------------------------------------------------------------ provenance ----

const prov = (u, vars, env = {}, headers = []) => go(one(u, headers, vars), env).provenance;

check("one row per occurrence, not per variable", () =>
  prov("https://a.example/{{x}}?q={{x}}", { x: "1" }).length === 2);
check("provenance ordering is url then headers", () => {
  const p = prov("https://a.example/{{x}}", { x: "1" }, {},
    [{ name: "a", value: "{{x}}" }]);
  return p[0].path === "url" && p[1].path === "headers[0]";
});
check("transformation is reported per position", () => {
  const p = prov("https://a.example/{{x}}?q={{x}}", { x: "a b" });
  return p[0].produced === "a%20b" && p[1].produced === "a%20b";
});
check("produced bytes are exact", () =>
  prov("https://a.example/x?q={{q}}", { q: "a b" })[0].produced === "a%20b");
check("transformed false when bytes unchanged", () =>
  prov("https://a.example/{{x}}", { x: "abc" })[0].transformed === false);
check("transformed true when bytes changed", () =>
  prov("https://a.example/{{x}}", { x: "a b" })[0].transformed === true);
check("provenance names the source", () =>
  prov("https://a.example/{{x}}", { x: "1" })[0].source === "variables.x");
check("env source is 'environment'", () =>
  prov("https://a.example", {}, { A: "1" }, [{ name: "a", value: "{{$env.A}}" }])[0]
    .source === "environment");
check("a whole-origin variable is attributed to itself", () =>
  prov("{{b}}/users", { b: "https://a.example" })[0].produced === "https://a.example");
// The same value, in a URL and in a header, from one workspace: transformed in
// the URL and not in the header. Position determines transformation, which is
// the reason provenance has one row per OCCURRENCE.
//
// This replaces a check that read `.length === 0 || true`. The assertion was
// wrong — the fixture substitutes one header span, so the length is 1 — and the
// `|| true` was silencing the failure rather than covering a redundancy. It
// counted toward 133 and tested nothing.
check("a span transformed in a url is not transformed in a header", () => {
  const p = prov("https://a.example/?q={{x}}", { x: "a b" }, {},
    [{ name: "a", value: "{{x}}" }]);
  const url = p.find((r) => r.path === "url");
  const header = p.find((r) => r.path === "headers[0]");
  return url.transformed === true && url.produced === "a%20b" &&
    header.transformed === false && header.produced === "a b";
});
check("header span produced equals substituted", () => {
  const p = prov("https://a.example", { x: "a b" }, {}, [{ name: "a", value: "{{x}}" }]);
  return p[0].produced === "a b" && p[0].transformed === false;
});
check("literals appear in segments but not provenance", () => {
  const r = go(one("https://a.example/{{x}}", [], { x: "1" }));
  return r.segments.url.some((s) => s.kind === "literal") && r.provenance.length === 1;
});
check("segments carry literals for --json", () =>
  go(one("https://a.example/{{x}}", [], { x: "1" })).segments.url.length === 2);
check("determined is true for an ordinary span", () =>
  prov("https://a.example/{{x}}", { x: "1" })[0].determined === true);

// --------------------------------------------------------------- secrets ----

const SECRET = "s3cr3t-value-1234";
const withSecret = (u, headers) => go(one(u, headers), { API_TOKEN: SECRET });

check("secret masked in a header", () =>
  withSecret("https://a.example", [{ name: "a", value: "Bearer {{$env.API_TOKEN}}" }])
    .projection.headers.filter((h) => h.origin === "workspace")[0].value === "Bearer \u2022\u2022\u2022\u2022");
check("secret absent from the whole result", () =>
  !JSON.stringify(withSecret("https://a.example",
    [{ name: "a", value: "Bearer {{$env.API_TOKEN}}" }])).includes(SECRET));
check("secret segment carries the key, never the value", () => {
  const r = withSecret("https://a.example", [{ name: "a", value: "{{$env.API_TOKEN}}" }]);
  const s = r.segments.headers[0].value[0];
  return s.key === "API_TOKEN" && s.value === undefined;
});
check("secret in a url is masked", () =>
  withSecret("https://a.example/x?k={{$env.API_TOKEN}}", []).projection.url
    === "https://a.example/x?k=\u2022\u2022\u2022\u2022");
check("secret in a url does not leak", () =>
  !JSON.stringify(withSecret("https://a.example/x?k={{$env.API_TOKEN}}", [])).includes(SECRET));
check("normalized secret is flagged without showing it", () => {
  const r = resolveWorkspace(one("https://a.example/x?k={{$env.T}}"),
    { env: { T: "a b" }, source: "t" });
  return r.provenance[0].produced === "\u2022\u2022\u2022\u2022 (masked, normalized)"
    && !JSON.stringify(r).includes("a%20b");
});
check("unnormalized secret says masked only", () =>
  withSecret("https://a.example/x?k={{$env.API_TOKEN}}", [])
    .provenance[0].produced === "\u2022\u2022\u2022\u2022 (masked)");
check("P4 no secret in CLI human output", () => {
  const r = run(["resolve", join(root, "examples", "example.reqtrail.json"),
    "--request", "get-user"], { API_TOKEN: SECRET });
  return !(r.stdout + r.stderr).includes(SECRET);
});
check("P4 no secret in CLI json output", () => {
  const r = run(["resolve", join(root, "examples", "example.reqtrail.json"),
    "--request", "get-user", "--json"], { API_TOKEN: SECRET });
  return !(r.stdout + r.stderr).includes(SECRET);
});

// ------------------------------------------------------ missing and empty ----

check("unset env is unresolved, not refused", () => {
  const r = go(one("https://a.example", [{ name: "a", value: "{{$env.NOPE}}" }]), {});
  return r.unresolved.length === 1 && r.resolvable === false;
});
check("unset env still renders the request", () =>
  go(one("https://a.example", [{ name: "a", value: "{{$env.NOPE}}" }]), {})
    .projection.headers.filter((h) => h.origin === "workspace")[0].value === "{{$env.NOPE}}");
check("unresolved names the variable", () =>
  go(one("https://a.example", [{ name: "a", value: "{{$env.NOPE}}" }]), {})
    .unresolved[0].variable === "NOPE");
check("undefined collection variable is unresolved", () =>
  go(one("https://a.example", [{ name: "a", value: "{{nope}}" }])).unresolved[0].code
    === "variable.undefined");
check("set-but-empty resolves and warns", () => {
  const r = go(one("https://a.example", [{ name: "a", value: "{{$env.E}}" }]), { E: "" });
  return r.resolvable === true && r.warnings.some((w) => w.code === "env.empty");
});
check("set-but-empty differs from unset — 'in', not truthiness", () => {
  const empty = go(one("https://a.example", [{ name: "a", value: "{{$env.E}}" }]), { E: "" });
  const unset = go(one("https://a.example", [{ name: "a", value: "{{$env.E}}" }]), {});
  return empty.resolvable === true && unset.resolvable === false;
});
check("env value '0' is not falsy-dropped", () =>
  go(one("https://a.example", [{ name: "a", value: "{{$env.Z}}" }]), { Z: "0" })
    .resolvable === true);
check("empty collection variable renders (empty) in provenance", () =>
  go(one("https://a.example", [{ name: "a", value: "{{x}}" }], { x: "" }))
    .provenance[0].empty === true);
check("an unresolved url is not normalized", () => {
  const r = go(one("https://a.example/a b/{{nope}}"));
  return r.urlResolved === false && r.projection.url === "https://a.example/a b/{{nope}}";
});
check("an unresolved url is never shown percent-mangled", () =>
  !go(one("https://a.example/{{nope}}")).projection.url.includes("%7B%7B"));
check("a resolved url with an unresolved header still normalizes", () => {
  const r = go(one("https://a.example/a b", [{ name: "a", value: "{{nope}}" }]));
  return r.urlResolved === true && r.projection.url === "https://a.example/a%20b";
});

// --------------------------------------------------------------- headers ----

check("duplicate header names survive", () => {
  const r = go(one("https://a.example", [
    { name: "X-Tag", value: "alpha" }, { name: "X-Tag", value: "beta" }]));
  return wh(r).length === 2 && wh(r)[1].value === "beta";
});
check("P3 identical name AND value survive as two", () => {
  const r = go(one("https://a.example", [
    { name: "X-Tag", value: "same" }, { name: "X-Tag", value: "same" }]));
  return wh(r).length === 2;
});
check("header casing preserved", () =>
  go(one("https://a.example", [{ name: "Authorization", value: "x" }]))
    .projection.headers.filter((h) => h.origin === "workspace")[0].name === "Authorization");
check("header order preserved", () => {
  const r = go(one("https://a.example", [
    { name: "a", value: "1" }, { name: "b", value: "2" }, { name: "c", value: "3" }]));
  return wh(r).map((h) => h.name).join("") === "abc";
});
// ---- THE DERIVED Host HEADER -------------------------------------------------
// Added 2026-09-08. `Host` is derived in the core, from the normalized URL,
// because under a flat header array node:http supplies none and a real server
// answers 400 without one. An adapter deriving it would be a second
// construction path and would compute it with no secret ranges attached.

const host = (r) => r.projection.headers.filter((h) => h.origin === "derived");

// THE RULE THAT COST FIVE INSTANCES BEFORE ANYONE WROTE IT DOWN.
//
// `src/ui/main.jsx` said "this release ... does not send them" and README.md
// said it in four more places, all true when written and all false the moment
// `run` shipped. Nothing caught any of them, because no check reads prose.
//
// A sentence naming a version, or asserting what the current release cannot do,
// is a value-pin on a surface no check reads. State the PROPERTY instead: `resolve`
// sends nothing because that is what the verb means, not because of a version.
//
// This check is deliberately crude. It cannot tell a true version claim from a
// stale one, so it forbids the SHAPE — which is the only thing a grep can know
// and the only thing that has ever gone wrong here.
// NOT a second version-agreement check — ":881 the version in package.json is
// the version the CLI reports" already covers that, end to end through the real
// binary, which is stronger than comparing two constants. Added here after
// writing a duplicate and deleting it: 9c, duplication is future disagreement.
//
// What :881 does NOT cover is the CRASH message, which is a different string on
// a different path and is exactly what went wrong in v0.2.0 — it named 0.1.0
// because it held its own copy. This pins that it interpolates rather than
// holding one.
check("the crash message interpolates the version, never a literal", () => {
  const src = stripComments(readSource("bin/reqtrail.js"));
  return /bug in reqtrail \$\{VERSION\}/.test(src) &&
    !/bug in reqtrail \d/.test(src);
});

// RELEASE.md IS A CHECKLIST, AND A CHECKLIST NOBODY CAN VERIFY IS A WISH.
// These pin the parts of it that are facts about this repo, so the document
// cannot drift away from the thing it describes — which is how every stale
// claim found on 2026-09-08 got there.
check("RELEASE.md names both files that hold the version", () => {
  const doc = readSource("RELEASE.md");
  return doc.includes("package.json") && doc.includes("src/cli/main.js");
});
check("RELEASE.md's version-bump step names files that really hold it", () => {
  const v = JSON.parse(readSource("package.json")).version;
  if (!readSource("src/cli/main.js").includes(`"${v}"`)) {
    throw new Error(`src/cli/main.js does not contain ${v}`);
  }
  return true;
});
// The tag-verification step tells you to use raw.githubusercontent and NOT
// codeload, because codeload serves cached tag tarballs. That sentence is the
// one that ended three rounds of guessing; pin that it survives edits.
check("RELEASE.md still warns that codeload caches tag tarballs", () => {
  const doc = readSource("RELEASE.md");
  return /raw\.githubusercontent\.com/.test(doc) && /codeload/.test(doc);
});

check("no user-visible prose pins a release", () => {
  const banned = /this release|current release|arrives in \d|ships in \d/i;
  for (const f of ["README.md", "src/ui/main.jsx", "src/cli/main.js"]) {
    const src = f.endsWith(".md") ? readSource(f) : stripComments(readSource(f));
    const hit = src.split("\n").find((l) => banned.test(l));
    if (hit) throw new Error(`${f} pins a release: ${hit.trim().slice(0, 60)}`);
  }
  return true;
});

check("the DISPLAY marks a derived header, not only --json", () => {
  const r = go(one("https://a.example/p"));
  const text = renderResolve(r);
  return text.includes("Host: a.example  (derived)");
});
check("a workspace header is NOT marked derived", () => {
  const r = go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example/p",
    headers: [{ name: "X-A", value: "1" }] }] }));
  return renderResolve(r).includes("X-A: 1\n") &&
    !/X-A: 1 .*derived/.test(renderResolve(r));
});
// The marker is APPENDED so a long value cannot push it off the line. A mutant
// aligning it to a computed column passes the two checks above and fails this.
check("the marker survives a header value long enough to break a column", () => {
  const r = go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example/p",
    headers: [{ name: "X-Long", value: "v".repeat(400) }] }] }));
  return renderResolve(r).includes("Host: a.example  (derived)");
});

check("Host is derived, and there is exactly one derived header", () => {
  const r = go(one("https://a.example/p"));
  return host(r).length === 1 && host(r)[0].name === "Host";
});
check("Host is FIRST, so the wire order is the displayed order", () =>
  go(one("https://a.example/p")).projection.headers[0].name === "Host");
check("Host omits a default port", () =>
  host(go(one("https://a.example:443/p")))[0].value === "a.example");
check("Host KEEPS a non-default port", () =>
  host(go(one("http://a.example:8080/p")))[0].value === "a.example:8080");
check("Host excludes userinfo — it carries host and port only", () =>
  host(go(one("http://user:pw@a.example/p")))[0].value === "a.example");
check("Host is ABSENT when the URL does not resolve", () =>
  host(go(one("{{nope}}/p"))).length === 0);
check("a secret in the hostname is MASKED in Host", () => {
  const r = go(one("https://{{$env.H}}/p"), { H: "secret.internal" });
  return host(r)[0].value === "\u2022\u2022\u2022\u2022";
});
check("a secret hostname is absent from the WHOLE result", () => {
  const r = go(one("https://{{$env.H}}/p"), { H: "secret.internal" });
  return !JSON.stringify(r).includes("secret.internal");
});
check("a workspace may not declare its own Host", () =>
  refusal(() => go(ws({ requests: [{ id: "r", method: "GET",
    url: "https://a.example/p",
    headers: [{ name: "Host", value: "evil.example" }] }] }))).code === "header.host");
check("a declared host is refused whatever its casing", () =>
  refusal(() => go(ws({ requests: [{ id: "r", method: "GET",
    url: "https://a.example/p",
    headers: [{ name: "hOsT", value: "evil.example" }] }] }))).code === "header.host");
check("EVERY projection header carries an origin", () => {
  const r = go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example/p",
    headers: [{ name: "X-A", value: "1" }, { name: "X-B", value: "2" }] }] }));
  return r.projection.headers.length === 3 &&
    r.projection.headers.every((h) => h.origin === "workspace" || h.origin === "derived");
});
// STRUCTURAL, not behavioural. `origin` must be COPIED by project(), never
// recomputed: a second place that knows which headers reqtrail adds is the
// shape the boundary release exists to have exactly one of. A mutant that
// rebuilds it from the header name passes every check above.
check("project() copies origin rather than deciding it", () => {
  const src = stripComments(readSource("src/core/exact.js"));
  return /origin:\s*h\.origin/.test(src) && !/origin:\s*["'`]/.test(src);
});
check("Host is assigned in exactly ONE place in the core", () => {
  const src = stripComments(readSource("src/core/prepare.js"));
  return (src.match(/name:\s*"Host"/g) ?? []).length === 1;
});

check("empty header value warns, not refused", () => {
  const r = go(one("https://a.example", [{ name: "a", value: "" }]));
  return r.resolvable === true && r.warnings.some((w) => w.code === "header.empty");
});
check("whitespace in a header value warns", () =>
  go(one("https://a.example", [{ name: "a", value: " x" }]))
    .warnings.some((w) => w.code === "header.whitespace"));
check("CR in a substituted header value refuses", () =>
  refusal(() => go(one("https://a.example", [{ name: "a", value: "{{x}}" }],
    { x: "ok\r\nX-Injected: evil" }))).code === "header.control");
check("LF refuses", () =>
  refusal(() => go(one("https://a.example", [{ name: "a", value: "{{x}}" }], { x: "a\nb" })))
    .code === "header.control");
check("NUL refuses", () =>
  refusal(() => go(one("https://a.example", [{ name: "a", value: "{{x}}" }], { x: "a\0b" })))
    .code === "header.control");
check("control refusal names the variable", () =>
  refusal(() => go(one("https://a.example", [{ name: "a", value: "{{x}}" }], { x: "a\rb" })))
    .variable === "x");
check("control refusal names the field path", () =>
  refusal(() => go(one("https://a.example", [
    { name: "a", value: "ok" }, { name: "b", value: "{{x}}" }], { x: "a\rb" })))
    .path === "headers[1]");
check("control chars in a literal header value refuse too", () =>
  refusal(() => go(one("https://a.example", [{ name: "a", value: "a\rb" }])))
    .code === "header.control");
check("a secret carrying CRLF is refused before anything is displayed", () =>
  refusal(() => go(one("https://a.example", [{ name: "a", value: "{{$env.T}}" }]),
    { T: "x\r\nEvil: 1" })).code === "header.control");

// ------------------------------------------------------------ CLI adapter ----

const exFile = join(root, "examples", "example.reqtrail.json");

check("resolve exits 0 when fully resolved", () =>
  run(["resolve", exFile, "--request", "get-user"], { API_TOKEN: "t" }).code === 0);
check("resolve exits 1 on an unresolved reference", () =>
  run(["resolve", exFile, "--request", "get-user"], {}).code === 1);
check("P5 unresolved still prints a payload on stdout", () => {
  const r = run(["resolve", exFile, "--request", "get-user"], {});
  return r.stdout.includes("GET https://api.example.com");
});
check("P5 unresolved --json stdout is parseable", () => {
  const r = run(["resolve", exFile, "--request", "get-user", "--json"], {});
  return JSON.parse(r.stdout).resolvable === false;
});
check("diagnostics go to stderr, never stdout", () => {
  const r = run(["resolve", exFile, "--request", "get-user", "--json"], {});
  return r.stderr.includes("unresolved:") && !r.stdout.includes("unresolved:");
});
check("ambiguous selection exits 1 and lists ids", () => {
  const r = run(["resolve", exFile]);
  return r.code === 1 && r.stderr.includes("get-user, list-users");
});
check("unknown command exits 2", () => run(["frobnicate"]).code === 2);
check("unknown option exits 2", () => run(["resolve", exFile, "--wat"]).code === 2);
check("missing file exits 2", () => run(["resolve", "/nonexistent.json"]).code === 2);
check("--request with no value exits 2", () =>
  run(["resolve", exFile, "--request"]).code === 2);
check("--json with ui exits 2", () => run(["ui", exFile, "--json"]).code === 2);
check("--version prints only the version, and nothing else", () => {
  // WAS `=== "0.1.0"`, the fifth value-pin found in this pass. It duplicated
  // the package.json comparison further down while adding a literal that had
  // to be edited on every release. What is actually being asserted here is
  // SHAPE — one bare semver line, no banner, no trailing prose — so that is
  // what it now checks, leaving version identity to the one check that owns it.
  const out = run(["--version"]).stdout;
  return /^\d+\.\d+\.\d+\n?$/.test(out);
});
check("--help exits 0", () => run(["--help"]).code === 0);
check("help says nothing is sent", () =>
  run(["--help"]).stdout.includes("run shows it and then sends it"));
check("a refusal in --json mode emits JSON on stderr", () => {
  const r = run(["resolve", exFile, "--json"]);
  return JSON.parse(r.stderr).error.code === "selection.ambiguous";
});
check("a refusal in --json mode writes nothing to stdout", () =>
  run(["resolve", exFile, "--json"]).stdout === "");
// The environment is captured once, at the CLI composition root, and passed
// down. `resolve` took an injected environment while `ui` read ambient state
// inside the server module and ignored it — the same defect as the first parity
// failure, one layer up in composition. Comments are stripped, because this
// change is worth a comment that names `process.env`.
check("the server module reads no ambient environment", () => {
  const src = stripComments(readSource("src/server/server.js"));
  return !/process\.env/.test(src);
});
check("the CLI captures the environment once", () => {
  const src = stripComments(readSource("src/cli/main.js"));
  return (src.match(/process\.env/g) ?? []).length === 1;
});

check("exit code 3 is unreachable — no transport exists", () => {
  // COMMENTS STRIPPED, and this is the fourth time on this project that a
  // pattern match has confused a mention with a use — after
  // dangerouslySetInnerHTML, the always-true guard, and the enumerator's line
  // window. This one fired on a comment reading "node:http's validateHeaderValue"
  // because the apostrophe completed the pattern's quote. A check that makes
  // documenting the code impossible gets deleted rather than obeyed.
  const src = ["src/core/prepare.js", "src/core/url.js", "src/core/grammar.js",
    "src/core/parse.js", "src/cli/main.js"]
    .map((f) => stripComments(readSource(f))).join("\n");
  return !/node:https?["']/.test(src) && !/\bfetch\s*\(/.test(src);
});

// Removes // and /* */ comments without touching string contents. Small enough
// to read, which matters: a stripper that silently eats code would make the
// check above pass for the wrong reason.
function stripComments(src) {
  let out = "";
  let i = 0;
  let str = null;
  while (i < src.length) {
    const c = src[i];
    if (str) {
      if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
      if (c === str) str = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; out += c; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

function readSource(rel) {
  return readFileSync(join(root, rel), "utf8");
}

// Header values are refused exactly where node:http would refuse them. The set
// was established by exhaustive measurement, not from documentation.
check("an ESC is refused", () =>
  refusal(() => go(one("https://a.example", [{ name: "X", value: "\u001b[31m" }])))
    .code === "header.charset");
check("DEL is refused", () =>
  refusal(() => go(one("https://a.example", [{ name: "X", value: "a\u007fb" }])))
    .code === "header.charset");
check("a vertical tab is refused", () =>
  refusal(() => go(one("https://a.example", [{ name: "X", value: "a\u000bb" }])))
    .code === "header.charset");
check("an emoji is refused", () =>
  refusal(() => go(one("https://a.example", [{ name: "X", value: "hi \u{1F600}" }])))
    .code === "header.charset");
check("the refusal names the code point", () =>
  refusal(() => go(one("https://a.example", [{ name: "X", value: "a\u007fb" }])))
    .cause.includes("U+007F"));
check("the refusal names the variable that carried it", () =>
  refusal(() => go(one("https://a.example", [{ name: "X", value: "{{v}}" }],
    { v: "a\u007fb" }))).variable === "v");
check("a tab is accepted — node accepts it", () =>
  go(one("https://a.example", [{ name: "X", value: "a\tb" }])).resolvable === true);
check("latin-1 is accepted with a warning, not refused", () => {
  const r = go(one("https://a.example", [{ name: "X", value: "caf\u00e9" }]));
  return r.resolvable === true && r.warnings.some((w) => w.code === "header.latin1");
});

// ------------------------------------------------------------ artifacts ----
// Content addressing answers "are these bytes identical"; it never answers "is
// this sentence still true". These four are the sentences that can be checked
// mechanically, so they are.

const readme = readSource("README.md");

check("the README's worked example is the actual output", () => {
  const block = readme.match(/\$ API_TOKEN=\.\.\. reqtrail resolve[^\n]*\n([\s\S]*?)```/);
  if (!block) throw new Error("the example block is not in the README any more");
  const r = run(["resolve", exFile, "--request", "get-user"], { API_TOKEN: "x" });
  // Trailing spaces are compared away, per line, and this is a real weakening
  // with a real reason: `X-Empty: ` ends in a space that a markdown file cannot
  // be trusted to carry — two trailing spaces are a line break in markdown, and
  // editors strip them. The first run of this check failed on exactly that.
  // The empty-header rendering stays covered by the checks above and by --json.
  const rstrip = (t) => t.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
  const shown = rstrip(block[1]);
  const actual = rstrip(r.stdout);
  if (shown !== actual) {
    throw new Error(`README shows:\n${shown}\n\nreqtrail prints:\n${actual}`);
  }
  return true;
});
// The README's OPENING COMMAND, run as written against the README's own
// workspace example. The existing drift check reads a fenced output block and
// therefore never looked at the first command a reader types — which named a
// file that did not exist AND omitted a --request the file requires, so it
// failed twice. A check that covers only the part that looks checkable is how
// that survived three commits.
check("the README's first command works, as written", () => {
  const cmd = readme.match(/\n {4}npx reqtrail (resolve[^\n]*)/);
  if (!cmd) throw new Error("the opening command is not in the README any more");
  // THE FILENAME COMES FROM THE README'S INSTRUCTION, NOT FROM THE COMMAND.
  // The first version of this check wrote the file to whatever name the command
  // named, so it manufactured the conditions the command needed and could not
  // fail on a wrong path — it assumed the thing it existed to verify. Taking
  // the two independently is what makes a mismatch between "save it as X" and
  // "resolve Y" visible.
  const saveAs = readme.match(/save the workspace file[^`]*`([^`]+)`/i);
  if (!saveAs) throw new Error("the README no longer says what to save the file as");
  const json = readme.match(/```json\n([\s\S]*?)```/)[1];
  const dir = mkdtempSync(join(tmpdir(), "reqtrail-readme-"));
  const args = cmd[1].trim().split(/\s+/);
  writeFileSync(join(dir, saveAs[1]), json);
  const r = execFileSync(process.execPath, [bin, ...args], {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, API_TOKEN: "x" },
  });
  rmSync(dir, { recursive: true, force: true });
  return r.includes("GET https://api.example.com/users/42");
});

check("the README's workspace example resolves", () => {
  const block = readme.match(/```json\n([\s\S]*?)```/);
  const r = resolveWorkspace(block[1], { env: { API_TOKEN: "x" }, source: "README" });
  return r.resolvable === true && wh(r).length === 3;
});
// REWRITTEN 2026-09-07, and this is the third guard in two days that pinned an
// artifact's CURRENT VALUE rather than the PROPERTY it was defending.
//
// It required the literal string "0.1.0 sends nothing". That string is a lie in
// every release after 0.1.0, so the guard would have had to be edited on every
// publish — and until it was, it would have BLOCKED the correction it existed
// to protect. A guard that must be disabled to fix the thing it guards is
// worse than no guard.
//
// It matters more here than in the repo, because **npm serves the README from
// the published tarball**: whatever wording ships is frozen against that
// version forever and cannot be edited without publishing again. A
// version-agnostic claim is true in every snapshot; a version-pinned one is a
// future lie in every snapshot but the one it shipped with. npm's page for
// 0.1.0 is currently proof of that — it still tells visitors `run` arrives in
// 0.2.0, because the repo fix cannot reach it.
//
// So the property is pinned instead: the README claims no transport, without
// naming a version, and the core has no transport for it to be wrong about.
// When `run` lands in 0.3.0 this fails loudly and correctly.
// SUPERSEDED 2026-09-08. It required the README to contain the literal
// "This release sends nothing" — a check enforcing the very value-pin that went
// stale the moment `run` shipped. A GUARD THAT PINS THE WRONG SENTENCE IS WORSE
// THAN NO GUARD: it blocks its own correction. Same shape as the `0.1.0 sends
// nothing` pin 9d recorded. Replaced by "no user-visible prose pins a release",
// which forbids the SHAPE rather than requiring a sentence.
check("the README states what `resolve` does, not what a release does", () => {
  if (!/`resolve` sends nothing, ever/.test(readme)) {
    throw new Error("the README no longer states the property");
  }
  return true;
});
// The evidence document drifted to 129 against a suite of 155 once already, and
// a stranger reads it first to decide whether the release's claims are backed.
// The counts it quotes are checkable, so they are checked — the same argument as
// the README's worked example.
// SPLIT 2026-09-07, and the reason matters more than the mechanism.
//
// This was ONE check: EVIDENCE-0.1.0.md must quote the suite's current count.
// It fired correctly when the boundary work added checks — and the fix it was
// asking for was WRONG. 159/159 is true of v0.1.0: published, tagged, attested,
// its tree sha recorded in decisions.md. Editing it to match `main` would make
// a released artifact's evidence false about the release it documents, in order
// to keep a check green.
//
// A frozen artifact must stay frozen; it must not stay WRONG ABOUT ITSELF. That
// document is frozen and is not wrong. So the drift guard follows the LIVE
// evidence document, and the frozen one gets a freeze guard instead — pinning
// the number so that a later session cannot helpfully update it either.
check("EVIDENCE-0.1.0.md stays frozen at the count v0.1.0 actually shipped", () => {
  const ev = readSource("EVIDENCE-0.1.0.md");
  const m = ev.match(/selftest\s+(\d+)\/(\d+)/);
  if (!m) throw new Error("EVIDENCE-0.1.0.md no longer quotes a selftest count");
  if (Number(m[2]) !== 159) {
    throw new Error(`EVIDENCE-0.1.0.md says ${m[2]}; v0.1.0 shipped 159 and is frozen`);
  }
  return true;
});

// POSITION-DEPENDENT WHEN FIRST WRITTEN, and found during the post-commit
// verification rather than by the check itself. `.match()` returns the FIRST
// hit, and this document legitimately contains a `selftest 159/159` in the
// prose explaining why EVIDENCE-0.1.0.md stays frozen. It passed only because
// the live counts happened to appear earlier in the file. Moving a section
// would have made it read the wrong number — silently, since 159 is a real
// count that a stranger would not question.
//
// So every quoted count is collected and the DISAGREEING ones are named. A
// count matching the frozen 159 is allowed only where the surrounding line
// marks it as the historical value.
// CONVERTED FROM A DRIFT GUARD TO A FREEZE GUARD, 2026-09-08, and the reason is
// 9d recurring rather than a new problem.
//
// This was the LIVE half of the split 9d prescribes: freeze guard on
// EVIDENCE-0.1.0.md, drift guard on BOUNDARY-EVIDENCE.md. That was right on
// 2026-09-07 and stopped being right the moment v0.2.0 was tagged, published
// and attested. Adding the Host checks moved the suite 171 -> 184 and this
// check demanded that a PUBLISHED release's evidence be edited to quote a count
// that release never had, to stay green. That is 9d's first error exactly, one
// document later: obeying the guard falsifies the record.
//
// THE CLASS, which is worth more than this instance: the split was made once,
// but nothing ages a live evidence document into a frozen one at publish. Every
// release turns the previous release's document frozen and leaves a drift guard
// pointed at it. This will happen again at 0.4.0 unless the transition is part
// of the release procedure rather than something a failing check discovers.
//
// THE DRIFT GUARD IS NOW UNPOINTED, and that is stated rather than hidden.
// 0.3.0's evidence document does not exist yet, so the guard has no subject —
// the same reasoning that retired P9. It returns, pointed at
// TRANSPORT-EVIDENCE.md, when that file is written, and until then NOTHING
// checks that a live document tracks the suite count.
check("BOUNDARY-EVIDENCE.md keeps the count v0.2.0 SHIPPED", () => {
  const doc = readSource("BOUNDARY-EVIDENCE.md");
  const quoted = [...doc.matchAll(/selftest\s+(\d+)\/(\d+)/g)].map((m) => Number(m[1]));
  if (quoted.length === 0) {
    throw new Error("BOUNDARY-EVIDENCE.md no longer quotes a selftest count");
  }
  const wrong = quoted.filter((n) => n !== 171 && n !== 159);
  if (wrong.length) {
    throw new Error(`BOUNDARY-EVIDENCE.md says ${wrong.join(", ")}; v0.2.0 shipped 171 and is frozen`);
  }
  return true;
});

// FROZEN 2026-09-08, the same day it was pointed here, because v0.3.0 was
// tagged and published in between.
//
// It was a DRIFT guard — "quotes this suite's actual count", compared against
// EXPECTED. Correct while 0.3.0 was being prepared and wrong the moment it
// shipped: the next check anyone adds moves EXPECTED, and this would demand
// that a PUBLISHED release record be edited to a count that release never had.
// That is exactly what BOUNDARY-EVIDENCE.md's version of this check did on the
// morning of the same day.
//
// **THE TRANSITION WAS DONE AS A RELEASE ACTION, NOT DISCOVERED BY A RED
// CHECK.** That is the whole point of the note that used to sit here.
//
// THIRD INSTANCE OF THE CLASS: EVIDENCE-0.1.0.md, BOUNDARY-EVIDENCE.md, now
// this. Every release turns the previous release's evidence document frozen and
// leaves a drift guard aimed at it. **Freezing the outgoing guard and
// re-pointing the drift guard belongs in the release procedure**, beside
// bumping VERSION and verifying the tag resolves to the verified sha — not in a
// comment the next person has to happen to read.
//
// THE DRIFT GUARD IS NOW UNPOINTED, stated rather than hidden: 0.4.0's evidence
// document does not exist, so the guard has no subject — the reasoning that
// retired P9. Until it is written, NOTHING checks that a live document tracks
// the suite count.
check("TRANSPORT-EVIDENCE.md keeps the count v0.3.0 SHIPPED", () => {
  const doc = readSource("TRANSPORT-EVIDENCE.md");
  const quoted = [...doc.matchAll(/selftest\s+(\d+)\/(\d+)/g)].map((m) => Number(m[1]));
  if (quoted.length === 0) {
    throw new Error("TRANSPORT-EVIDENCE.md quotes no selftest count");
  }
  const wrong = quoted.filter((n) => n !== 196);
  if (wrong.length) {
    throw new Error(`TRANSPORT-EVIDENCE.md says ${wrong.join(", ")}; v0.3.0 shipped 196 and is published`);
  }
  return true;
});

check("EVIDENCE-0.1.0.md records P4 as falsified, not as held", () => {
  const ev = readSource("EVIDENCE-0.1.0.md");
  return /\|\s*P4\s*\|[^|]*\|\s*\*\*WRONG/.test(ev);
});

check("the version in package.json is the version the CLI reports", () => {
  const pkg = JSON.parse(readSource("package.json"));
  return pkg.version === run(["--version"]).stdout.trim();
});

check("no check in this suite is silenced with an always-true clause", () => {
  const suspicious = /\|\|\s*true|&&\s*true\b|=>\s*true\s*\)/;
  for (const f of readdirSync(join(root, "test"))) {
    if (!f.endsWith(".mjs")) continue;
    const src = readFileSync(join(root, "test", f), "utf8");
    for (const [i, raw] of src.split("\n").entries()) {
      const line = raw.trim();
      // COMMENTS ARE SKIPPED, and the reason is a repeat offence: the first
      // version of this check failed on the comment that documents it, exactly
      // as the dangerouslySetInnerHTML source grep did in test/ui.mjs. A
      // pattern match cannot tell a use from a mention, and a check that makes
      // documenting a rule impossible gets deleted rather than obeyed.
      if (line.startsWith("//") || line.startsWith("*")) continue;
      if (line.includes("const suspicious")) continue;
      if (suspicious.test(line)) {
        throw new Error(`test/${f}:${i + 1} cannot report failure: ${line.slice(0, 80)}`);
      }
    }
  }
  return true;
});

// ------------------------------------------------------- P-DERIVE ---------
//
// The boundary release's pass condition. P-CONTAIN is measured by
// test/leak-audit.mjs across 28 fixtures; these are the derivation half.
//
// WHAT THESE CAN AND CANNOT DO, stated because the pre-registration predicted
// the gap (B3). An output comparison — project(exact) equals the returned
// projection — CANNOT distinguish a correct second construction path from a
// derivation, because a second path that computes the same bytes passes it on
// every input tested. Output equality catches a BROKEN second path, not a
// working one. So the derivation is enforced STRUCTURALLY as well: exactly one
// function substitutes the mask into request text, and nothing outside the core
// can reach the exact request at all. The structural checks are the ones that
// kill the equivalent-output mutant; the output check is what makes them
// meaningful rather than cosmetic.

const derivationCorpus = [
  ["plain", one("https://a.example/x"), {}],
  ["variable", one("https://a.example/{{v}}", [], { v: "q" }), {}],
  ["normalizing", one("https://a.example/a b?x={{v}}", [], { v: "c d" }), {}],
  ["secret in url", one("https://a.example/x?k={{$env.API_TOKEN}}"), { API_TOKEN: SECRET }],
  ["secret in header", one("https://a.example",
    [{ name: "Authorization", value: "Bearer {{$env.API_TOKEN}}" }]), { API_TOKEN: SECRET }],
  ["two secrets", one("https://a.example/{{$env.A}}/{{$env.B}}"), { A: "aaa", B: "bbb" }],
  ["unresolved url", one("https://a.example/{{nope}}"), {}],
  ["unresolved secret", one("https://a.example",
    [{ name: "a", value: "{{$env.NOPE}}" }]), {}],
  ["mixed", one("https://a.example/{{v}}?k={{$env.API_TOKEN}}",
    [{ name: "a", value: "x{{v}}y{{$env.API_TOKEN}}z" }], { v: "vv" }),
    { API_TOKEN: SECRET }],
];

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check("P-DERIVE — the projection is project(exact) for every corpus case", () => {
  for (const [label, text, env] of derivationCorpus) {
    const { exact, view } = __prepareForTest(text, { env, source: "t.json" });
    if (!eq(project(exact), view.projection)) {
      throw new Error(`${label}: projection is not project(exact)`);
    }
  }
  return true;
});

check("P-DERIVE — project() is pure: same input, same output, no ambient state", () => {
  for (const [label, text, env] of derivationCorpus) {
    const { exact } = __prepareForTest(text, { env, source: "t.json" });
    if (!eq(project(exact), project(exact))) throw new Error(`${label}: not deterministic`);
  }
  const src = stripComments(readSource("src/core/exact.js"));
  if (/process\.env/.test(src)) throw new Error("exact.js reads ambient process state");
  return true;
});

check("the exact request carries real secret bytes — otherwise these checks are vacuous", () => {
  // WITHOUT THIS, every check here passes on a build where `exact` is masked
  // too, and the derivation would be a tautology over two identical values.
  // A positive control, per the rule that an instrument must be shown to fire.
  const { exact } = __prepareForTest(
    one("https://a.example/x?k={{$env.API_TOKEN}}"),
    { env: { API_TOKEN: SECRET }, source: "t.json" });
  return exact.url.text.includes(SECRET) && exact.url.secretRanges.length === 1;
});

check("the public view holds no secret bytes although the exact request does", () => {
  for (const [label, text, env] of derivationCorpus) {
    const { view } = __prepareForTest(text, { env, source: "t.json" });
    if (JSON.stringify(view).includes(SECRET)) throw new Error(`${label}: secret in view`);
  }
  return true;
});

check("`exact` never reaches the public result", () => {
  for (const [, text, env] of derivationCorpus) {
    const r = resolveWorkspace(text, { env, source: "t.json" });
    if ("exact" in r) throw new Error("resolveWorkspace returned the exact request");
  }
  return true;
});

check("ONE masking site — nothing outside exact.js substitutes the mask into request text", () => {
  // THIS CHECK WAS WRITTEN WEAKER AND A MUTANT WALKED PAST IT. The first
  // version forbade only `maskRanges`. The mutant that beat it did not call
  // maskRanges: it rebuilt the projection from grammar.js's `masked()`, which
  // is a genuine second construction path producing byte-identical output. It
  // survived all 168 checks, exactly as B3 predicted an output comparison would
  // let it.
  //
  // So BOTH maskers are named. `masked()` still has one legitimate caller —
  // url.js, which needs a masked string for refusal messages before the URL has
  // parsed — and that is a message, not a request projection, so url.js is
  // exempt by name rather than by accident.
  const forbidden = [
    ["src/core/prepare.js", /maskRanges|\bmasked\s*\(/],
    ["src/core/parse.js", /maskRanges|\bmasked\s*\(/],
    ["src/core/grammar.js", /maskRanges/],
    ["src/cli/render.js", /maskRanges|\bmasked\s*\(/],
    ["src/cli/main.js", /maskRanges|\bmasked\s*\(/],
    ["src/server/server.js", /maskRanges|\bmasked\s*\(/],
    ["src/ui/logic.js", /maskRanges|\bmasked\s*\(/],
    ["src/ui/main.jsx", /maskRanges|\bmasked\s*\(/],
  ];
  for (const [f, pat] of forbidden) {
    if (pat.test(stripComments(readSource(f)))) {
      throw new Error(`${f} masks a request value — the mask has a second site`);
    }
  }
  return /export function maskRanges/.test(readSource("src/core/exact.js"));
});

check("the projection is assigned from project() and from nothing else", () => {
  // The structural companion to P-DERIVE's output check. A second path has to
  // be ASSIGNED somewhere, so the assignment site is pinned: `projection:` is
  // written exactly once in the core and its value is the call.
  const src = stripComments(readSource("src/core/prepare.js"));
  const sites = src.match(/projection\s*:/g) ?? [];
  if (sites.length !== 1) {
    throw new Error(`${sites.length} projection assignment sites, expected 1`);
  }
  return /projection:\s*project\(exact\)/.test(src);
});

check("no adapter reaches the exact request", () => {
  const adapters = ["src/cli/render.js", "src/cli/main.js", "src/server/server.js",
    "src/ui/logic.js", "src/ui/main.jsx", "bin/reqtrail.js"];
  for (const f of adapters) {
    const src = stripComments(readSource(f));
    if (/__prepareForTest|prepareFromWorkspace/.test(src)) {
      throw new Error(`${f} reaches past inspect() to the construction path`);
    }
  }
  return true;
});

// REPLACED 2026-09-08. It required that `run` NOT be exported, and it fired by
// design the moment `run` shipped. What it was defending is not the absence of
// `run` — it is that `run` is a CONSUMER of the pair and not a second way to
// build a request. That is what these check.
check("`inspect` and `run` are both exported use cases", () => {
  const src = readSource("src/core/prepare.js");
  return /export function inspect\b/.test(src) &&
    /export async function run\b/.test(src);
});
check("`run` consumes the pair — it never calls prepareRequest itself", () => {
  const src = stripComments(readSource("src/core/prepare.js"));
  const body = src.slice(src.indexOf("export async function run"));
  return body.includes("prepareFromWorkspace(text, options)") &&
    !/prepareRequest\s*\(/.test(body);
});
check("prepareFromWorkspace has exactly TWO consumers", () => {
  const src = stripComments(readSource("src/core/prepare.js"));
  return (src.match(/prepareFromWorkspace\(/g) ?? []).length === 3; // 1 def + 2 uses
});
check("the transport is imported by the core and by NO adapter", () => {
  const adapters = ["src/cli/render.js", "src/cli/main.js", "src/server/server.js",
    "src/ui/logic.js", "src/ui/main.jsx", "bin/reqtrail.js"];
  for (const f of adapters) {
    if (/transport\//.test(stripComments(readSource(f)))) {
      throw new Error(`${f} imports the transport directly`);
    }
  }
  return /from "\.\.\/transport\/http\.js"/.test(readSource("src/core/prepare.js"));
});
// A TRANSPORT ERROR'S PROSE CARRIES VALUES FROM THE REQUEST. Measured:
// `getaddrinfo ENOTFOUND secret-host.invalid`. A secret can be the hostname, so
// the message and node's `hostname` / `address` / `port` fields must never be
// copied into the result.
check("run surfaces a transport CODE and never a message or address", () => {
  const src = stripComments(readSource("src/core/prepare.js"));
  const body = src.slice(src.indexOf("function transportCode"));
  return !/e\.(message|hostname|address|port)/.test(body);
});
check("an unrecognisable transport code is replaced, not passed through", () => {
  const src = stripComments(readSource("src/core/prepare.js"));
  return /CODE_SHAPE\.test\(e\.code\)/.test(src) &&
    /"transport\.failed"/.test(src);
});
check("exit code 3 is documented as REACHABLE, not as unreachable", () => {
  const src = readSource("src/cli/main.js");
  return /3\s+send attempted and failed/.test(src) &&
    !/UNREACHABLE while there is no transport/.test(src);
});

// --------------------------------------------- the published surface -------
//
// FOUND BEFORE THE 0.2.0 PUBLISH, and it is the same class as the five
// value-pins: the README cited four repo paths that the TARBALL DOES NOT
// CONTAIN. `test/` is not in package.json's `files`, and neither are
// EVIDENCE-0.1.0.md nor LEAK-AUDIT-EVIDENCE.md. On GitHub every reference
// resolved, so nothing looked wrong; on npm a stranger reading "see
// LEAK-AUDIT-EVIDENCE.md" — the backing for the containment claim that was
// wrong twice — would have found nothing to see.
//
// npm's README is frozen per published version, so shipping that state would
// have preserved it until the next release, exactly as 0.1.0's stale schedule
// claim is preserved now.
//
// THE PROPERTY: every repo path the README names either ships in the tarball or
// is written as an absolute URL. Not "these four paths are fine" — that would be
// a value-pin, and the next citation added would not be covered.
//
// Tarball membership is computed from package.json's `files` rather than by
// running `npm pack`, DELIBERATELY: `prepack` is `npm test`, so shelling out to
// npm pack from inside the suite would recurse. It is also why the discovery
// grep was wrong the first time — `npm notice` writes to STDERR, and a
// 2>/dev/null on the check reported every file as missing.
check("every repo path the README names either ships or is an absolute URL", () => {
  const pkg = JSON.parse(readSource("package.json"));
  const files = pkg.files ?? [];
  const ships = (path) => files.some((f) =>
    f.endsWith("/") ? path.startsWith(f) : f === path);

  const linked = new Set();
  for (const m of readme.matchAll(/\]\(https:\/\/[^)]+?\/blob\/[^/]+\/([^)#]+)\)/g)) {
    linked.add(m[1]);
  }

  const dangling = new Set();
  // The stem class INCLUDES a dot. It did not at first, so `EVIDENCE-0.1.0.md`
  // — a dotted stem — never matched and was never checked. The guard passed on
  // it by not seeing it, which is the exact failure it was written to catch,
  // one level up. Found by re-running the mutant against a SECOND path rather
  // than trusting the first kill.
  for (const m of readme.matchAll(/`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:md|mjs|js|json))`/g)) {
    const path = m[1];
    // Bare filenames the prose uses as a name the reader will type or create,
    // not as a pointer into the repo.
    if (path === "example.reqtrail.json") continue;
    if (ships(path) || linked.has(path)) continue;
    dangling.add(path);
  }
  if (dangling.size) {
    // A Set, not an array: a doc cited twice was reported twice, which made a
    // one-file problem read as a two-file one. Found by running the mutants.
    throw new Error(
      `README cites ${dangling.size} path(s) absent from the tarball and not ` +
      `linked: ${[...dangling].join(", ")}`);
  }
  return true;
});

check("every README link into this repo points at a file that exists", () => {
  // The cost of the link route: a rename breaks the link silently, and npm
  // freezes the broken link for the life of the release. So the targets are
  // checked to exist on disk at publish time.
  const missing = [];
  for (const m of readme.matchAll(/\]\((https:\/\/github\.com\/antrixy\/reqtrail\/blob\/[^/]+\/([^)#]+))\)/g)) {
    try { readSource(m[2]); } catch { missing.push(m[2]); }
  }
  if (missing.length) {
    throw new Error(`README links to non-existent path(s): ${missing.join(", ")}`);
  }
  return true;
});

// ------------------------------------------------------------- tripwire ----

if (failures.length) {
  console.error(`FAIL ${failures.length} of ${passed}`);
  for (const f of failures) console.error("  " + f);
}
if (passed !== EXPECTED) {
  console.error(`FAIL count tripwire: ran ${passed} checks, expected ${EXPECTED}`);
  process.exit(1);
}
if (failures.length) process.exit(1);
console.log(`selftest ${passed}/${EXPECTED} OK`);
