// Every refuse() call site in the core, and a CHECK on the one property that
// makes the leak class impossible rather than merely fixed:
//
//   A refusal's message argument must be a string LITERAL with no `${}` in it.
//
// If a call site can interpolate, it can bake a value into prose, and by the
// time an adapter sees it there is nothing left to say it needs escaping. That
// is how three environment secrets reached four output channels and nine
// terminal escapes reached the terminal. Values travel in the values object,
// where they are escaped once, in errors.js.
//
// This file reports and checks. Run it directly to see the enumeration; it
// exits non-zero if any call site interpolates.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "src/core";
const files = readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "errors.js");

const rows = [];
for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (!/\brefuse\(/.test(line)) return;
    // Take the ACTUAL call, by balancing parentheses from `refuse(`. A fixed
    // line window over-attributes: the first version of this script credited
    // grammar.unmatched with a `${ref}` belonging to the NEXT call site, which
    // inflated both reported figures. A window is not a parser.
    const before = lines.slice(0, i).join("\n").length;
    const from = src.indexOf("refuse(", before);
    let depth = 0, end = from;
    for (let k = src.indexOf("(", from); k < src.length; k++) {
      if (src[k] === "(") depth++;
      else if (src[k] === ")") { depth--; if (depth === 0) { end = k; break; } }
    }
    const chunk = src.slice(from, end + 1);
    const code = (chunk.match(/refuse\(\s*"([^"]+)"/) || [])[1] ?? "(dynamic)";

    // The message is the third argument. Everything up to it may legitimately
    // interpolate — a field path is built from indices and key names — so only
    // the message is checked. Paths are escaped in errors.js.
    const args = splitArgs(chunk.slice(chunk.indexOf("(") + 1, -1));
    const message = args[2] ?? "";
    rows.push({
      file: f, line: i + 1, code,
      interpolates: /\$\{/.test(message),
      message: message.trim().replace(/\s+/g, " ").slice(0, 60),
    });
  });
}

// Split on top-level commas only, so a values object does not fool it.
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = "", str = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) {
      if (c === "\\") { cur += c + s[++i]; continue; }
      if (c === str) str = null;
      cur += c; continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; cur += c; continue; }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const bad = rows.filter((r) => r.interpolates);

if (process.argv.includes("--list")) {
  for (const r of rows) {
    console.log(`  ${(r.file + ":" + r.line).padEnd(20)} ${r.code.padEnd(26)} ${r.message}`);
  }
  console.log();
}

console.log(`refusals ${rows.length - bad.length}/${rows.length} carry a literal message`);
if (bad.length) {
  console.error("\nFAIL — these call sites interpolate a value into the message:");
  for (const r of bad) console.error(`  ${r.file}:${r.line}  ${r.code}  ${r.message}`);
  console.error("\nValues belong in the values object, where errors.js escapes them once.");
  process.exit(1);
}
