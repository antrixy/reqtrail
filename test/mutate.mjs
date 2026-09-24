// Mutation coverage. A suite that has never failed is a hypothesis wearing a
// test suite's clothes: it proves the code runs, not that the checks discriminate.
//
// Each mutant below is a single edit that breaks a stated contract. The suite
// must FAIL for every one. A survivor is reported by name — it means the
// contract it breaks is unchecked, and that is a finding, not a nuisance.
//
// One mutant is marked "equivalent": it changes no behaviour, so it MUST
// survive, and a run in which it dies is as much a failure as a survivor. The
// argument for each equivalence is written beside it and is what a reader
// should attack.
//
// Others are marked "uncovered": they change behaviour that NOTHING in
// `npm test` can observe, because the only oracle is the browser sitting and a
// sitting cannot run per mutant. They must survive too. Marking them is the
// difference between a gap that is known and one that is merely absent — and if
// a browser check ever lands in CI, the harness reports the status change
// rather than quietly gaining coverage nobody notices.

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync,
  symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MUTANTS = [
  ["whitespace inside a reference is accepted",
    "src/core/grammar.js",
    "if (ref !== ref.trim()) {", "if (false) {"],

  ["missing and empty env are conflated by truthiness",
    "src/core/grammar.js",
    "const set = Object.prototype.hasOwnProperty.call(env, key);",
    "const set = Boolean(env[key]);"],

  ["a nested template is expanded rather than refused",
    "src/core/grammar.js",
    'if (set && env[key].includes("{{")) {', "if (false) {"],

  ["a nested collection variable is accepted",
    "src/core/grammar.js",
    'if (defined && vars[ref].includes("{{")) {', "if (false) {"],

  ["a secret is rendered in place of the mask",
    "src/core/grammar.js",
    ': s.secret ? "\\u2022\\u2022\\u2022\\u2022"', ": s.secret ? s.key"],

  // Anchor WIDENED in 0.4.1: `u.hash = "";` occurs twice in url.js (here and in
  // the attribution probe), and the harness replaces the first match. It hit
  // the intended site by position alone; the uniqueness check below now
  // refuses an anchor that matches more than once.
  ["the URL fragment is kept",
    "src/core/url.js",
    'const hadFragment = u.hash !== "";\n  u.hash = "";',
    'const hadFragment = u.hash !== "";\n  /* kept */'],

  // RETARGETED IN 0.4.1. Masking moved from url.js into exact.js's maskRanges
  // at the 0.2.0 boundary split, and this anchor stayed behind: the harness has
  // reported it as MUTATION DID NOT APPLY since then, and no run finished to
  // show it. Same mutant, in the one place masking now happens.
  ["secret byte ranges in the URL are not masked",
    "src/core/exact.js",
    "for (let i = ranges.length - 1; i >= 0; i--) {",
    "for (let i = -1; i >= 0; i--) {"],

  // EQUIVALENT. `produced` is sliced out of `href` between an offset proved by
  // startsWith(outer) and one proved by endsWith(suffix), with the length guard
  // ensuring the first does not pass the second. The three pieces therefore
  // concatenate to `href` for every input, and the line can never fire.
  // Removing it removes nothing. Recorded rather than "fixed" with a check
  // written to make a tautology look tested.
  ["span attribution without the (tautological) reconstruction line",
    "src/core/url.js",
    "if (outer + produced + suffix !== href) continue;", "/* tautology */",
    "equivalent"],

  ["a non-http scheme is accepted",
    "src/core/url.js",
    'if (u.protocol !== "http:" && u.protocol !== "https:") {\n    // The scheme is named only',
    'if (false) {\n    // The scheme is named only'],

  ["an unrecognised schema version is read anyway",
    "src/core/parse.js",
    "if (doc.version !== SCHEMA_VERSION) {", "if (false) {"],

  ["duplicate JSON members are accepted, last-wins",
    "src/core/parse.js",
    "  const dup = findDuplicateMember(text);", "  const dup = null;",
    "killed", "selftest.mjs"],

  ["the duplicate scanner ignores array indices in the path",
    "src/core/parse.js",
    "return parent.array ? `${parent.path}[${parent.index}]` : parent.pending;",
    "return parent.array ? parent.path : parent.pending;",
    "killed", "selftest.mjs"],

  ["the duplicate scanner does not track array position",
    "src/core/parse.js",
    "if (top?.array) top.index++;", "",
    "killed", "selftest.mjs"],

  ["string contents are scanned as if they were structure",
    "src/core/parse.js",
    "      } else {\n        readString();\n      }",
    "      } else {\n        i++;\n      }",
    "killed", "selftest.mjs"],

  ["an unreferenceable variable name is accepted",
    "src/core/parse.js",
    "if (!VARIABLE_NAME.test(name)) {", "if (false) {",
    "killed", "selftest.mjs"],

  ["duplicate request ids are first-wins",
    "src/core/parse.js",
    "if (seen.has(id)) {", "if (false) {"],

  ["a header name is not checked against the token set",
    "src/core/parse.js",
    "if (!TOKEN.test(name)) {", "if (false) {"],

  ["unknown keys are ignored",
    "src/core/parse.js",
    "if (!allowed.includes(key)) {", "if (false) {"],

  ["a method other than GET is accepted",
    "src/core/parse.js",
    'if (method !== "GET") {', "if (false) {"],

  ["several requests resolve the first one silently",
    "src/core/parse.js",
    "refuse(\"selection.ambiguous\", \"requests\",", "return workspace.requests[0]; refuse(\"selection.ambiguous\", \"requests\","],

  ["header values are not checked against the transport's set",
    "src/core/prepare.js",
    // Anchor moved in 0.4.1 (D5 named the predicate `isBad`).
    "const bad = [...flat].find(isBad);",
    "const bad = undefined;",
    "killed", "selftest.mjs"],

  ["the accepted set admits everything above U+00FF",
    "src/core/prepare.js",
    "/[\\t\\u0020-\\u007e\\u0080-\\u00ff]/", "/[\\s\\S]/",
    "killed", "selftest.mjs"],

  ["DEL is admitted by widening the printable range",
    "src/core/prepare.js",
    "\\u0020-\\u007e\\u0080", "\\u0020-\\u00ff\\u0080",
    "killed", "selftest.mjs"],

  ["latin-1 is refused instead of warned",
    "src/core/prepare.js",
    'warnings.push({ code: "header.latin1", path,',
    'refuse("header.charset", path, "latin-1"); warnings.push({ code: "header.latin1", path,',
    "killed", "selftest.mjs"],

  ["CR and LF in a header value are not refused",
    "src/core/prepare.js",
    "if (/[\\r\\n\\0]/.test(flat)) {", "if (/[\\0]/.test(flat)) {"],

  ["an unresolved URL is normalized anyway",
    "src/core/prepare.js",
    "const urlResolved = allResolved(urlSegs);", "const urlResolved = true;"],

  ["unresolved references do not affect resolvability",
    "src/core/prepare.js",
    "resolvable: unresolved.length === 0,", "resolvable: true,"],

  ["a secret span reports its produced bytes",
    "src/core/prepare.js",
    "out.produced = span.transformed ? `${MASK} (masked, normalized)` : `${MASK} (masked)`;",
    "out.produced = span.produced ?? `${MASK} (masked)`;"],

  ["control characters are not escaped in a message",
    "src/core/errors.js",
    "for (const [k, v] of Object.entries(values)) safe[k] = quote(v);",
    "for (const [k, v] of Object.entries(values)) safe[k] = String(v);", "killed", "leak-audit.mjs"],

  ["the field path is not escaped",
    "src/core/errors.js",
    "path: escapeControls(path),", "path,", "killed", "leak-audit.mjs"],

  ["DEL and C1 are left unescaped",
    "src/core/errors.js",
    // Anchor moved in 0.4.1: the class no longer ends at C1 (D2 added CR,
    // bidi controls and separators after it). Same mutant, same expectation.
    "\\u007f-\\u009f\\u061c", "\\u061c", "killed", "leak-audit.mjs"],

  ["the url refusal names the raw url instead of the masked one",
    "src/core/url.js",
    "{ url: display });", "{ url: str });", "killed", "leak-audit.mjs"],

  // Aimed at the real property: when the masked string cannot be parsed, the
  // scheme must NOT be recovered from the raw one. That is the exact leak.
  ["the scheme falls back to the raw url when masking breaks the parse",
    "src/core/url.js",
    "} catch { safeScheme = null; }",
    "} catch { safeScheme = new URL(str).protocol.slice(0, -1); }", "killed", "leak-audit.mjs"],

  // RETARGETED IN 0.4.1. The line became `const line = ...` when 0.3.0 added
  // the (derived) marker, and the anchor has not matched since.
  ["rendered header values are not escaped",
    "src/cli/render.js",
    "const line = `${esc(h.name)}: ${esc(h.value)}`;",
    "const line = `${h.name}: ${h.value}`;", "killed", "leak-audit.mjs"],


  // ---- the loopback server: seventeen rows, previously unmutated ----------
  // Each names the suite that should kill it. A row with a check that cannot
  // fail shows up here as a survivor, which is the whole point.

  ["UI row 1 — the server binds every interface",
    "src/server/server.js",
    'server.listen(0, "127.0.0.1", () => {', "server.listen(0, () => {",
    "killed", "server.mjs"],

  ["UI row 3 — the session token is not checked",
    "src/server/server.js",
    "if (!constantEquals(presented, token)) {", "if (false) {",
    "killed", "server.mjs"],

  ["UI row 3 — token comparison is not constant time",
    "src/server/server.js",
    "return timingSafeEqual(x, y);", "return String(a) === String(b);",
    "killed", "server.mjs"],

  ["UI row 4 — the Host header is not validated (rebinding)",
    "src/server/server.js",
    "if (req.headers.host !== expectedHost) {", "if (false) {",
    "killed", "server.mjs"],

  ["UI row 4 — an absent Origin is accepted on the API",
    "src/server/server.js",
    "if (isApi ? origin !== expectedOrigin",
    "if (isApi ? (origin !== undefined && origin !== expectedOrigin)",
    "killed", "server.mjs"],

  ["UI row 5 — a CORS allowance is emitted",
    "src/server/server.js",
    '"referrer-policy": "no-referrer",\n    "cache-control": "no-store",\n  });\n  res.end(body);\n}\n\nfunction send',
    '"referrer-policy": "no-referrer",\n    "cache-control": "no-store",\n    "access-control-allow-origin": "*",\n  });\n  res.end(body);\n}\n\nfunction send',
    "killed", "server.mjs"],

  ["server row 1 — the header count limit is removed",
    "src/server/server.js",
    "if (req.rawHeaders.length / 2 > LIMITS.maxHeaderCount) {", "if (false) {",
    "killed", "server.mjs"],

  // ROUTE-DISTINGUISHING. The plain body-limit mutant below dies to
  // /api/resolve whatever /api/session does, so it could not see that the row
  // was enforced on one route only. This one can.
  ["server row 2 — the body limit is skipped on /api/session alone",
    "src/server/server.js",
    "      let raw;\n      try {\n        raw = await readBody(req, LIMITS.maxBodyBytes);",
    "      let raw;\n      if (path === \"/api/session\") raw = \"{}\"; else\n      try {\n        raw = await readBody(req, LIMITS.maxBodyBytes);",
    "killed", "server.mjs"],

  ["server row 4 — the slow-body deadline never fires",
    "src/server/server.js",
    "    }, LIMITS.bodyReadTimeoutMs);", "    }, 3_600_000);",
    "killed", "server-slow.mjs"],

  ["server row 4 — the deadline fires but keeps consuming",
    "src/server/server.js",
    "      req.pause();\n      done(reject, new Error(\"slow\"));",
    "      done(reject, new Error(\"slow\"));",
    "uncovered", "server-slow.mjs"],

  ["server row 2 — the body size limit is removed",
    "src/server/server.js",
    "if (size > limit) {", "if (false) {",
    "killed", "server.mjs"],

  ["server rows 3, 4 — the enforcement interval returns to the 30s default",
    "src/server/server.js",
    "connectionsCheckingInterval: LIMITS.connectionsCheckingIntervalMs,", "",
    "killed", "server-slow.mjs"],

  ["server row 5 — any content type is accepted",
    "src/server/server.js",
    'if (ct !== "application/json") {', "if (false) {",
    "killed", "server.mjs"],

  ["server row 6 — the method is not checked",
    "src/server/server.js",
    'if (req.method !== "POST") return fail(res, 405, "method", "method not allowed");',
    "",
    "killed", "server.mjs"],

  ["server row 10 — the body is read before authenticating",
    "src/server/server.js",
    'const auth = req.headers.authorization ?? "";',
    'await readBody(req, LIMITS.maxBodyBytes).catch(() => {});\n      const auth = req.headers.authorization ?? "";',
    "killed", "server.mjs"],

  ["the secret crosses the loopback boundary",
    "src/server/server.js",
    "const result = resolveWorkspace(text, { requestId, env, source: file });",
    "const result = { ...resolveWorkspace(text, { requestId, env, source: file }), env };",
    "killed", "server.mjs"],

  // ---- the browser UI -----------------------------------------------------
  // H3 predicts every one of these SURVIVES, because the UI's behaviour is
  // checked only by a sitting that needs a browser and does not run in
  // `npm test`. If that holds, it is a statement about what the evidence
  // supports, not a to-do.

  ["the ui server reads ambient environment again",
    "src/server/server.js",
    "assets: loadAssets(), env, requestId,",
    "assets: loadAssets(), env: { ...process.env }, requestId,",
    "killed", "selftest.mjs"],

  ["a missing UI build is reported as an internal error again",
    "src/server/server.js",
    '      failToStart("ui.not-built",',
    '      throw new Refusal({ code: "ui.not-built", path: "dist", cause: "x" }); failToStart("ui.not-built",',
    "killed", "ui.mjs"],

  ["a missing UI build exits 1, as though the workspace were at fault",
    "src/cli/main.js",
    "        err(`reqtrail: ${e.detail.cause} [${e.detail.code}]\\n`);\n        return 2;",
    "        err(`reqtrail: ${e.detail.cause} [${e.detail.code}]\\n`);\n        return 1;",
    "killed", "ui.mjs"],

  ["UI — a refusal is classified as a result again",
    "src/ui/logic.js",
    'if (body && body.error) return { kind: "refusal", error: body.error };', "",
    "killed", "ui.mjs"],

  ["UI — an unknown --request silently falls back to the first request",
    "src/ui/logic.js",
    "if (session.requestId !== null && session.requestId !== undefined) {",
    "if (session.requests.some((r) => r.id === session.requestId)) {",
    "killed", "ui.mjs"],

  ["UI — the sequence guard admits a stale response",
    "src/ui/logic.js",
    "      if (ticket !== issued) return false;", "",
    "killed", "ui.mjs"],

  ["UI — the component ignores the sequencer's verdict",
    "src/ui/main.jsx",
    "if (!seq.current.mayApply(mine)) return;   // a newer selection won", "",
    "uncovered", "ui.mjs"],

  ["UI — the session token is left in the address bar",
    "src/ui/main.jsx",
    'window.history.replaceState(null, "", window.location.pathname);', "",
    "killed", "ui.mjs"],

  ["an unresolved request exits 0",
    "src/cli/main.js",
    "return result.resolvable ? 0 : 1;", "return 0;"],

  ["diagnostics are written to stdout",
    "src/cli/main.js",
    "err(renderDiagnostics(result));", "out(renderDiagnostics(result));"],

  // Anchor WIDENED in 0.4.1: the encoding refusal (D1) added an identical
  // `else err(renderRefusal(...)); return 1;` block EARLIER in main(), so this
  // mutant silently moved to the new site — it still died, for a different
  // reason. The trailing brace pins it to the workspace-refusal catch again.
  ["a refusal exits 0",
    "src/cli/main.js",
    "else err(renderRefusal(e.detail));\n    return 1;\n  }\n}",
    "else err(renderRefusal(e.detail));\n    return 0;\n  }\n}"],

  // --- 0.4.1 honesty patch (HONESTY-PATCH-PREREGISTRATION.md increment 8) ---
  // One mutant per mechanism the patch added, each undoing exactly that fix.
  // P9 predicted every one is killed on its first run.

  ["D2 — CR is left unescaped again (the 0.4.0 gap at \\u000d)",
    "src/core/errors.js",
    "\\u0000-\\u0008\\u000b-\\u001f", "\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f",
    "killed", "leak-audit.mjs"],

  ["D2 — bidi overrides are left unescaped",
    "src/core/errors.js",
    "\\u202a-\\u202e", "", "killed", "leak-audit.mjs"],

  ["D2 — line and paragraph separators are left unescaped",
    "src/core/errors.js",
    "\\u2028\\u2029]/g", "]/g", "killed", "leak-audit.mjs"],

  ["P-TERMINAL — a usage error echoes an argument unescaped",
    "src/cli/main.js",
    "err(`reqtrail: ${escapeControls(e.message)}\\n\\n${USAGE}`);",
    "err(`reqtrail: ${e.message}\\n\\n${USAGE}`);", "killed", "leak-audit.mjs"],

  ["P-TERMINAL — an unreadable path is echoed unescaped",
    "src/cli/main.js",
    "err(`reqtrail: ${escapeControls(e.message)}\\n`);",
    "err(`reqtrail: ${e.message}\\n`);", "killed", "leak-audit.mjs"],

  ["D6 — the ui banner echoes the file name unescaped",
    "src/server/server.js",
    "serving ${escapeControls(file)} as read", "serving ${file} as read"],

  ["D5 — a secret's disallowed character is named by code point",
    "src/core/prepare.js",
    "if (culprit && culprit.secret) {", "if (false) {"],

  ["D5 — the code point comes from the first bad character, not the culprit",
    "src/core/prepare.js",
    "codepoint: pointOf([...culprit.value].find(isBad))", "codepoint: pointOf(bad)"],

  ["D3 — a zero-length secret range is masked",
    "src/core/exact.js",
    "    if (ranges[i].start === ranges[i].end) continue;\n", ""],

  ["D4 — userinfo is accepted and shown",
    "src/core/url.js",
    'if (u.username !== "" || u.password !== "") {', "if (false) {"],

  ["D1 — malformed UTF-8 is repaired instead of refused",
    "src/core/parse.js",
    "{ fatal: true, ignoreBOM: true }", "{ fatal: false, ignoreBOM: true }"],

  ["D1 — a BOM is silently stripped (a relaxation the release did not rule)",
    "src/core/parse.js",
    "{ fatal: true, ignoreBOM: true }", "{ fatal: true, ignoreBOM: false }"],

  ["D1 — an encoding refusal exits 0",
    "src/cli/main.js",
    "else err(renderRefusal(e.detail));\n    return 1;\n  }\n\n  if (opts.command",
    "else err(renderRefusal(e.detail));\n    return 0;\n  }\n\n  if (opts.command"],

  ["D8 — a root key's path gets its leading dot back",
    "src/core/parse.js",
    'refuse("schema.unknown-key", path ? `${path}.${key}` : key,',
    'refuse("schema.unknown-key", `${path}.${key}`,'],

  // ---- 0.5.0, the exact transport request (EXACT-TRANSPORT-PREREGISTRATION.md
  // increment 7). Each targets SELFTEST, which this harness runs; wire.mjs is
  // not run here until 0.6.0, which is why D2 made `wireOptions` pure.
  //
  // The first three are ALSO caught by `transportFromHref`'s reconstruction
  // check, which refuses when the slices disagree with the URL API. That is the
  // check working, not redundancy in the mutant: each would otherwise send the
  // wrong target, host or port.
  ["0.5.0 D1 — the target is rebuilt as pathname + search (RT-A2)",
    "src/core/url.js",
    'const requestTarget = slash === -1 ? "" : href.slice(slash);',
    "const requestTarget = u.pathname + u.search;"],

  ["0.5.0 D1 — an IPv6 literal keeps its brackets as the connect hostname (RT-B2)",
    "src/core/url.js",
    'const connectHostname = hostPart.startsWith("[") ? hostPart.slice(1, -1) : hostPart;',
    "const connectHostname = hostPart;"],

  ["0.5.0 D1 — the default port is dropped",
    "src/core/url.js",
    'const port = portText === "" ? defaultPort : Number(portText);',
    'const port = portText === "" ? undefined : Number(portText);'],

  ["0.5.0 D2 — the transport connects to the authority, port and all",
    "src/transport/http.js",
    "hostname: t.connectHostname,", "hostname: t.authority,"],

  ["0.5.0 D3 — Trailer is dropped from the framing set",
    "src/core/prepare.js",
    '"upgrade", "trailer"]);', '"upgrade"]);'],

  ["0.5.0 D4 — the Connection allowlist admits any value",
    "src/core/prepare.js",
    '["close", "keep-alive"].includes(h.exact.text.toLowerCase())',
    '["close", "keep-alive"].length > 0'],
];

const SUITES = ["selftest.mjs", "leak-audit.mjs", "server.mjs",
  "server-slow.mjs", "ui.mjs"];

// Running every suite against every mutant costs ~13s each, most of it
// server.mjs's deliberate five-second stalled-header measurement. At forty
// mutants that is ten minutes, which is how a mutation pass stops being run.
//
// So a mutant declares the suite that SHOULD kill it. That suite runs first;
// only if the mutant survives does the rest of the suite run. The third outcome
// is the interesting one: a mutant killed by a suite OTHER than the declared
// one dies, but the check meant to protect that behaviour is not the one doing
// it — a finding about the suite, not a pass.
// A FRESH COPY OF THE TREE, with node_modules linked rather than copied.
//
// THE FILTER MATCHES `.git` AS A PATH SEGMENT. It used to be the substring
// `/.git`, which also matches `/.github` — so no mutant directory had one, and
// a selftest check that reads `.github/` (0.5.0, D5) failed in every mutant.
// Found in 0.5.0 when an equivalent mutant and two uncovered ones all "died".
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), "reqtrail-mutant-"));
  cpSync(root, dir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules") && !/\/\.git(\/|$)/.test(src),
  });
  // dist/ is gitignored but present in a working tree; ui.mjs reads it.
  if (!existsSync(join(dir, "dist", "app.js"))) {
    cpSync(join(root, "dist"), join(dir, "dist"), { recursive: true });
  }
  // node_modules is excluded from the copy for speed, but ui.mjs imports
  // esbuild. WITHOUT THIS, ui.mjs throws in every mutant directory and the
  // harness counts the throw as a kill — so every mutant that reached it was
  // reported dead regardless of what it did. A harness that cannot tell a
  // failing check from a failing import reports no survivors and means
  // nothing. Symlinked rather than copied: a copy is 40 MB per mutant.
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

function runSuite(dir, suite) {
  try {
    execFileSync(process.execPath, [join(dir, "test", suite)],
      { cwd: dir, stdio: "pipe", env: { PATH: process.env.PATH } });
    return false;   // survived
  } catch { return true; }   // killed
}

// THE UNMUTATED TREE MUST PASS EVERY SUITE FIRST. A kill means "this edit made
// a suite fail" only if the suite passed without it. 0.5.0 added a mutant whose
// replacement text tripped selftest's always-true source check, so selftest
// failed on the unmutated tree, and every selftest-declared mutant "died". No
// line here noticed. Now the harness refuses to count anything until the copy
// it mutates is green.
{
  const dir = copyTree();
  try {
    const red = SUITES.filter((s) => runSuite(dir, s));
    if (red.length) {
      console.error(`mutation: NOT RUN — the unmutated tree fails ${red.join(", ")}. ` +
        "A kill means nothing against a suite that is already red.");
      process.exit(1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const survivors = [];
const misattributed = [];
let killed = 0;

for (const [name, file, from, to, expect = "killed", suite = "selftest.mjs"] of MUTANTS) {
  const dir = copyTree();
  try {
    const path = join(dir, file);
    const src = readFileSync(path, "utf8");
    if (!src.includes(from)) {
      survivors.push(`${name} — MUTATION DID NOT APPLY (anchor not found in ${file})`);
      continue;
    }
    // AN ANCHOR MUST MATCH ONCE. `replace` edits the first match, so an anchor
    // that occurs twice mutates whichever site comes first — and a later edit
    // above the intended site moves the mutant without any failure. Found in
    // 0.4.1, where it had happened to two mutants.
    if (src.split(from).length !== 2) {
      survivors.push(`${name} — ANCHOR NOT UNIQUE (${src.split(from).length - 1} matches in ${file})`);
      continue;
    }
    writeFileSync(path, src.replace(from, to));

    // The declared suite first.
    let died = runSuite(dir, suite);
    if (!died) {
      // Then everything else, before calling anything a survivor.
      for (const other of SUITES.filter((x) => x !== suite)) {
        if (runSuite(dir, other)) {
          died = true;
          if (expect !== "equivalent") {
            misattributed.push(`${name} — declared ${suite}, killed by ${other}`);
          }
          break;
        }
      }
    }
    if (expect === "equivalent" || expect === "uncovered") {
      if (died) survivors.push(`${name} — EXPECTED TO SURVIVE (${expect}) BUT ` +
        "WAS KILLED; the argument for it no longer holds");
      else killed++;
    } else if (died) killed++;
    else survivors.push(name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const eq = MUTANTS.filter((m) => m[4] === "equivalent").length;
const unc = MUTANTS.filter((m) => m[4] === "uncovered").length;
console.log(`mutation: ${killed}/${MUTANTS.length} accounted for ` +
  `(${eq} equivalent, ${unc} uncovered — see the notes beside them)`);
if (misattributed.length) {
  console.error("\nKILLED BY THE WRONG SUITE — the check meant to cover this is not the one working:");
  for (const m of misattributed) console.error("  " + m);
}
if (survivors.length) {
  console.error("UNACCOUNTED MUTANTS:");
  for (const s of survivors) console.error("  " + s);
  process.exit(1);
}
