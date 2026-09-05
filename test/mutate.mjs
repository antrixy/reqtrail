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

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from "node:fs";
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
    'if (u.protocol !== "http:" && u.protocol !== "https:") {\n    refuse("url.scheme"',
    'if (false) {\n    refuse("url.scheme"'],

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

const survivors = [];
let killed = 0;

for (const [name, file, from, to, expect = "killed"] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), "reqtrail-mutant-"));
  try {
    cpSync(root, dir, {
      recursive: true,
      filter: (src) => !src.includes("node_modules") && !src.includes("/.git"),
    });
    const path = join(dir, file);
    const src = readFileSync(path, "utf8");
    if (!src.includes(from)) {
      survivors.push(`${name} — MUTATION DID NOT APPLY (anchor not found in ${file})`);
      continue;
    }
    writeFileSync(path, src.replace(from, to));

    let died = false;
    try {
      execFileSync(process.execPath, [join(dir, "test", "selftest.mjs")],
        { cwd: dir, stdio: "pipe", env: { PATH: process.env.PATH } });
    } catch {
      died = true;
    }
    if (expect === "equivalent") {
      if (died) survivors.push(`${name} — EXPECTED EQUIVALENT BUT WAS KILLED; ` +
        "the equivalence argument no longer holds");
      else killed++;
    } else if (died) killed++;
    else survivors.push(name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`mutation: ${killed}/${MUTANTS.length} accounted for (1 expected equivalent)`);
if (survivors.length) {
  console.error("UNACCOUNTED MUTANTS:");
  for (const s of survivors) console.error("  " + s);
  process.exit(1);
}
