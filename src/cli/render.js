// Formatting only. This file must not decide anything: if a question can be
// answered here that a UI would also have to answer, it belongs in the core.

import { escapeControls as esc } from "../core/errors.js";

const MASK = "\u2022\u2022\u2022\u2022";

// Every value that reaches the terminal is escaped, not only the ones that came
// through a refusal. The leak audit found a workspace whose header value held an
// ANSI escape putting it on the terminal through the ORDINARY SUCCESS PATH —
// nothing refused, nothing warned. A tool that can be made to rewrite your
// terminal by a file it is describing has no claim, and the file is as capable
// of it as a remote server.
//
// Showing `\u001b[31m` rather than emitting it is also the more accurate
// rendering: it is what the header value contains.

export function renderPrepared(result) {
  const lines = [`${result.prepared.method} ${esc(result.prepared.url)}`];
  for (const h of result.prepared.headers) {
    lines.push(`${esc(h.name)}: ${esc(h.value)}`);
  }
  return lines.join("\n");
}

// What a span produced. The arrow appears ONLY when normalization changed the
// bytes, so its presence is itself the signal.
function produced(r) {
  if (!r.resolved) return "(unresolved)";
  if (r.secret) return r.produced;
  if (r.empty) return "(empty)";
  if (r.transformed) {
    return `${esc(JSON.stringify(r.substituted))} \u2192 ${esc(r.produced)}`;
  }
  if (r.produced !== undefined) return esc(r.produced);
  return esc(r.substituted);
}

export function renderProvenance(result) {
  if (result.provenance.length === 0) return "";
  const rows = result.provenance.map((r) => [
    esc(r.path), esc(r.reference),
    r.resolved ? esc(r.source) : `${esc(r.source)} (not set)`,
    produced(r) + (r.note ? `  [${r.note}]` : ""),
  ]);
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  const out = ["Substitutions"];
  for (const r of rows) {
    out.push("  " + r[0].padEnd(w[0]) + "  " + r[1].padEnd(w[1]) + "  " +
      r[2].padEnd(w[2]) + "  " + r[3]);
  }
  return out.join("\n");
}

export function renderResolve(result) {
  const parts = [renderPrepared(result)];
  const prov = renderProvenance(result);
  if (prov) parts.push("", prov);
  if (!result.urlResolved) {
    parts.push("", "The URL is shown as written: it contains an unresolved " +
      "reference and has not been normalized.");
  }
  return parts.join("\n") + "\n";
}

export function renderDiagnostics(result) {
  const out = [];
  for (const w of result.warnings) out.push(`warning: ${esc(w.path)}: ${esc(w.cause)}`);
  for (const u of result.unresolved) {
    out.push(`unresolved: ${esc(u.path)}: ${esc(u.cause)}`);
  }
  if (result.unresolved.length > 0) {
    out.push("this request cannot be sent until every reference resolves");
  }
  return out.length ? out.join("\n") + "\n" : "";
}

export function renderRefusal(detail) {
  const where = detail.path ? `${detail.path}: ` : "";
  return `reqtrail: ${where}${detail.cause} [${detail.code}]\n`;
}

export { MASK };
