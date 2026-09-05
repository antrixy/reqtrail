// Formatting only. This file must not decide anything: if a question can be
// answered here that a UI would also have to answer, it belongs in the core.

const MASK = "\u2022\u2022\u2022\u2022";

export function renderPrepared(result) {
  const lines = [`${result.prepared.method} ${result.prepared.url}`];
  for (const h of result.prepared.headers) lines.push(`${h.name}: ${h.value}`);
  return lines.join("\n");
}

// What a span produced. The arrow appears ONLY when normalization changed the
// bytes, so its presence is itself the signal.
function produced(r) {
  if (!r.resolved) return "(unresolved)";
  if (r.secret) return r.produced;
  if (r.empty) return "(empty)";
  if (r.transformed) return `${JSON.stringify(r.substituted)} \u2192 ${r.produced}`;
  if (r.produced !== undefined) return r.produced;
  return r.substituted;
}

export function renderProvenance(result) {
  if (result.provenance.length === 0) return "";
  const rows = result.provenance.map((r) => [
    r.path, r.reference, r.resolved ? r.source : `${r.source} (not set)`,
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
  for (const w of result.warnings) out.push(`warning: ${w.path}: ${w.cause}`);
  for (const u of result.unresolved) out.push(`unresolved: ${u.path}: ${u.cause}`);
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
