// Enumerate every refuse() call site in the core and classify what its message
// interpolates. Static, complete, and it finishes — as opposed to re-reading the
// module and forming an impression.
//
// The classification that matters is ORIGIN, not presence: a message containing
// `${typeof v}` is safe, a message containing `${v}` is not, and the difference
// is invisible to a reader skimming for template literals.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "src/core";
const files = readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "errors.js");

// Expressions that are safe to interpolate because they cannot carry a value:
// types, counts, and lists of allowed spellings written by the author.
const SAFE = [
  /^typeof\b/, /^\w+\.length$/, /^allowed\.join/, /^SCHEMA_VERSION$/,
  /^ids\.length$/, /^ids\.join/, /^LIMITS\./,
];

// Where an interpolated expression can get its value from.
function origin(expr, file) {
  if (SAFE.some((r) => r.test(expr.trim()))) return "safe";
  // Environment values enter the core only through plain()/env[key], and only
  // url.js calls plain().
  if (file === "url.js" && /\bstr\b|\braw\b|u\.protocol/.test(expr)) return "environment";
  if (/\bseg\.|\bs\.written\b|\bculprit\./.test(expr)) return "reference";
  return "file";
}

const rows = [];
for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (!/\brefuse\(/.test(line)) return;
    // Take the ACTUAL call, by balancing parentheses from `refuse(`. A fixed
    // line window over-attributes: the first run of this script credited
    // grammar.unmatched with a `${ref}` belonging to the NEXT call site, which
    // inflated both reported figures. A fixed window is not a parser.
    const from = src.indexOf("refuse(", src.split("\n").slice(0, i).join("\n").length);
    let depth = 0, end = from;
    for (let k = src.indexOf("(", from); k < src.length; k++) {
      if (src[k] === "(") depth++;
      else if (src[k] === ")") { depth--; if (depth === 0) { end = k; break; } }
    }
    const chunk = src.slice(from, end + 1);
    const code = (chunk.match(/refuse\(\s*"([^"]+)"/) || [])[1] ?? "(dynamic)";
    const exprs = [...chunk.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
    const origins = exprs.map((e) => origin(e, f));
    rows.push({ file: f, line: i + 1, code, exprs, origins });
  });
}

const cls = (r) =>
  r.origins.includes("environment") ? "ENVIRONMENT"
  : r.origins.includes("file") ? "file"
  : r.origins.includes("reference") ? "reference"
  : r.exprs.length ? "safe" : "literal";

console.log(`${rows.length} refuse() call sites in ${dir}\n`);
const order = ["ENVIRONMENT", "file", "reference", "safe", "literal"];
for (const k of order) {
  const group = rows.filter((r) => cls(r) === k);
  if (!group.length) continue;
  console.log(`  ${k} — ${group.length}`);
  for (const r of group) {
    console.log(`    ${(r.file + ":" + r.line).padEnd(20)} ${r.code.padEnd(26)} ` +
      (r.exprs.length ? r.exprs.map((e) => "${" + e.trim() + "}").join(" ") : ""));
  }
  console.log();
}

const interpolating = rows.filter((r) => !["literal", "safe"].includes(cls(r)));
console.log(`  C1 figure — sites interpolating a value the author did not write: ${interpolating.length}`);
console.log(`  C2 figure — sites that can carry an environment value: ${rows.filter((r) => cls(r) === "ENVIRONMENT").length}`);
console.log(`  C3 figure — sites that can carry workspace-file content: ${rows.filter((r) => cls(r) === "file").length}`);
