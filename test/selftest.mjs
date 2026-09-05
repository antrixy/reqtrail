// reqtrail selftest. A check that cannot report failure is not a check, so the
// count is asserted at the end: adding a check without updating EXPECTED fails
// the run, and so does a check that silently stops executing.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveWorkspace } from "../src/core/prepare.js";
import { parseWorkspace, selectRequest } from "../src/core/parse.js";
import { Refusal } from "../src/core/errors.js";

const EXPECTED = 134;

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
  go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example" }] })).prepared.method === "GET");
check("headers optional", () =>
  go(ws({ requests: [{ id: "r", method: "GET", url: "https://a.example" }] })).prepared.headers.length === 0);
check("duplicate id refuses", () =>
  refusal(() => go(ws({ requests: [
    { id: "r", method: "GET", url: "https://a.example" },
    { id: "r", method: "GET", url: "https://b.example" }] }))).code === "schema.id.duplicate");
check("id charset enforced", () =>
  refusal(() => go(ws({ requests: [{ id: "a b", method: "GET", url: "https://a.example" }] })))
    .code === "schema.id.charset");
check("POST refused in 0.1.0", () =>
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
  go(one("https://a.example/{{X}}", [], { X: "1", x: "2" })).prepared.url.endsWith("/1"));
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
  go(one("https://a.example/x?j=%7B%22a%22%3A1%7D")).prepared.url.includes("%7B%22a%22"));

// ------------------------------------------------------- url normalization ----

const url = (u, vars = {}, env = {}) => go(one(u, [], vars), env).prepared.url;

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
    .prepared.headers[0].value === "Bearer \u2022\u2022\u2022\u2022");
check("secret absent from the whole result", () =>
  !JSON.stringify(withSecret("https://a.example",
    [{ name: "a", value: "Bearer {{$env.API_TOKEN}}" }])).includes(SECRET));
check("secret segment carries the key, never the value", () => {
  const r = withSecret("https://a.example", [{ name: "a", value: "{{$env.API_TOKEN}}" }]);
  const s = r.segments.headers[0].value[0];
  return s.key === "API_TOKEN" && s.value === undefined;
});
check("secret in a url is masked", () =>
  withSecret("https://a.example/x?k={{$env.API_TOKEN}}", []).prepared.url
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
    .prepared.headers[0].value === "{{$env.NOPE}}");
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
  return r.urlResolved === false && r.prepared.url === "https://a.example/a b/{{nope}}";
});
check("an unresolved url is never shown percent-mangled", () =>
  !go(one("https://a.example/{{nope}}")).prepared.url.includes("%7B%7B"));
check("a resolved url with an unresolved header still normalizes", () => {
  const r = go(one("https://a.example/a b", [{ name: "a", value: "{{nope}}" }]));
  return r.urlResolved === true && r.prepared.url === "https://a.example/a%20b";
});

// --------------------------------------------------------------- headers ----

check("duplicate header names survive", () => {
  const r = go(one("https://a.example", [
    { name: "X-Tag", value: "alpha" }, { name: "X-Tag", value: "beta" }]));
  return r.prepared.headers.length === 2 && r.prepared.headers[1].value === "beta";
});
check("P3 identical name AND value survive as two", () => {
  const r = go(one("https://a.example", [
    { name: "X-Tag", value: "same" }, { name: "X-Tag", value: "same" }]));
  return r.prepared.headers.length === 2;
});
check("header casing preserved", () =>
  go(one("https://a.example", [{ name: "Authorization", value: "x" }]))
    .prepared.headers[0].name === "Authorization");
check("header order preserved", () => {
  const r = go(one("https://a.example", [
    { name: "a", value: "1" }, { name: "b", value: "2" }, { name: "c", value: "3" }]));
  return r.prepared.headers.map((h) => h.name).join("") === "abc";
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
check("--version prints only the version", () =>
  run(["--version"]).stdout.trim() === "0.1.0");
check("--help exits 0", () => run(["--help"]).code === 0);
check("help says nothing is sent", () =>
  run(["--help"]).stdout.includes("does not send"));
check("a refusal in --json mode emits JSON on stderr", () => {
  const r = run(["resolve", exFile, "--json"]);
  return JSON.parse(r.stderr).error.code === "selection.ambiguous";
});
check("a refusal in --json mode writes nothing to stdout", () =>
  run(["resolve", exFile, "--json"]).stdout === "");
check("exit code 3 is unreachable — no transport exists", () => {
  const src = ["src/core/prepare.js", "src/core/url.js", "src/core/grammar.js",
    "src/core/parse.js", "src/cli/main.js"]
    .map((f) => readSource(f)).join("\n");
  return !/node:https?["']/.test(src) && !/\bfetch\s*\(/.test(src);
});

function readSource(rel) {
  return readFileSync(join(root, rel), "utf8");
}

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
check("the README's workspace example resolves", () => {
  const block = readme.match(/```json\n([\s\S]*?)```/);
  const r = resolveWorkspace(block[1], { env: { API_TOKEN: "x" }, source: "README" });
  return r.resolvable === true && r.prepared.headers.length === 3;
});
check("the README does not claim this release sends anything", () =>
  readme.includes("0.1.0 sends nothing"));
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
