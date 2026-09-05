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

  ["the URL fragment is kept",
    "src/core/url.js",
    'u.hash = "";', "/* kept */"],

  ["secret byte ranges in the URL are not masked",
    "src/core/url.js",
    "for (let i = secretRanges.length - 1; i >= 0; i--) {",
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
    "\\u007f-\\u009f]/g;", "]/g;", "killed", "leak-audit.mjs"],

  ["the url refusal names the raw url instead of the masked one",
    "src/core/url.js",
    "{ url: display });", "{ url: str });", "killed", "leak-audit.mjs"],

  // Aimed at the real property: when the masked string cannot be parsed, the
  // scheme must NOT be recovered from the raw one. That is the exact leak.
  ["the scheme falls back to the raw url when masking breaks the parse",
    "src/core/url.js",
    "} catch { safeScheme = null; }",
    "} catch { safeScheme = new URL(str).protocol.slice(0, -1); }", "killed", "leak-audit.mjs"],

  ["rendered header values are not escaped",
    "src/cli/render.js",
    "lines.push(`${esc(h.name)}: ${esc(h.value)}`);",
    "lines.push(`${h.name}: ${h.value}`);", "killed", "leak-audit.mjs"],


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

  ["server row 2 — the body size limit is removed",
    "src/server/server.js",
    "if (size > limit) {", "if (false) {",
    "killed", "server.mjs"],

  ["server rows 3, 4 — the enforcement interval returns to the 30s default",
    "src/server/server.js",
    "connectionsCheckingInterval: LIMITS.connectionsCheckingIntervalMs,", "",
    "killed", "server.mjs"],

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

  ["UI — a refusal is rendered as a crash again",
    "src/ui/main.jsx",
    "if (r && r.error) setRefusal(r.error);", "if (false) setRefusal(r.error);",
    "uncovered", "ui.mjs"],

  ["UI — an unknown --request silently falls back to the first request",
    "src/ui/main.jsx",
    "if (s.requestId !== null && s.requestId !== undefined) {\n          setSelected(s.requestId);",
    "if (s.requests.some((r) => r.id === s.requestId)) {\n          setSelected(s.requestId);",
    "uncovered", "ui.mjs"],

  ["UI — the sequence guard is removed",
    "src/ui/main.jsx",
    "if (mine !== seq.current) return;   // a newer selection won", "",
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

  ["a refusal exits 0",
    "src/cli/main.js",
    "else err(renderRefusal(e.detail));\n    return 1;",
    "else err(renderRefusal(e.detail));\n    return 0;"],
];

const SUITES = ["selftest.mjs", "leak-audit.mjs", "server.mjs", "ui.mjs"];

// Running every suite against every mutant costs ~13s each, most of it
// server.mjs's deliberate five-second stalled-header measurement. At forty
// mutants that is ten minutes, which is how a mutation pass stops being run.
//
// So a mutant declares the suite that SHOULD kill it. That suite runs first;
// only if the mutant survives does the rest of the suite run. The third outcome
// is the interesting one: a mutant killed by a suite OTHER than the declared
// one dies, but the check meant to protect that behaviour is not the one doing
// it — a finding about the suite, not a pass.
function runSuite(dir, suite) {
  try {
    execFileSync(process.execPath, [join(dir, "test", suite)],
      { cwd: dir, stdio: "pipe", env: { PATH: process.env.PATH } });
    return false;   // survived
  } catch { return true; }   // killed
}

const survivors = [];
const misattributed = [];
let killed = 0;

for (const [name, file, from, to, expect = "killed", suite = "selftest.mjs"] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), "reqtrail-mutant-"));
  try {
    cpSync(root, dir, {
      recursive: true,
      filter: (src) => !src.includes("node_modules") && !src.includes("/.git"),
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
    const path = join(dir, file);
    const src = readFileSync(path, "utf8");
    if (!src.includes(from)) {
      survivors.push(`${name} — MUTATION DID NOT APPLY (anchor not found in ${file})`);
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
