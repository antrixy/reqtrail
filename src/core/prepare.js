// One construction site. One PreparedRequest. Consumed by every renderer.
//
// A `resolve` that builds its own view can be right in every test and wrong on
// the one request that matters, and that failure would be invisible because
// both halves look correct in isolation. So the core returns structures and the
// adapters own only formatting, stdout/stderr and exit codes.
//
// SECRETS. This comment used to say that no code path produces a resolved
// secret value at all. THAT WAS FALSE, and the leak audit found the gap it
// hid: `url.js` must materialise, because normalization has to see real bytes
// to report that a secret was re-encoded. Three refusals then quoted the
// materialised string and put the secret on four output channels.
//
// The accurate statement: there is no materialize() for SENDING, because 0.1.0
// has no transport. `src/core/url.js` is the one place a resolved secret
// exists, it holds it for the length of one function, and it returns masked
// bytes and nothing else — including in its refusals. Everything downstream of
// it, this file included, sees masks only.

import { refuse } from "./errors.js";
import { segment, masked, allResolved } from "./grammar.js";
import { normalizeUrl, MASK } from "./url.js";
import { parseWorkspace, selectRequest, SCHEMA_VERSION } from "./parse.js";

// A control-character probe that never materialises a secret it does not have
// to: unresolved references contribute their written form, which contains none.
const probe = (segs, env) =>
  segs.map((s) => (s.kind === "literal" ? s.text
    : !s.resolved ? s.written
    : s.secret ? env[s.key]
    : s.value)).join("");

const publicSegment = (s) => {
  if (s.kind === "literal") return { kind: "literal", text: s.text };
  const out = {
    kind: s.kind, reference: s.written, source: s.source,
    secret: s.secret, resolved: s.resolved, empty: s.empty,
  };
  if (s.kind === "variable") out.name = s.name; else out.key = s.key;
  if (s.kind === "variable" && s.resolved) out.value = s.value;
  return out;
};

export function prepareRequest(request, variables, env) {
  const warnings = [];
  const unresolved = [];

  const urlSegs = segment(request.url, "url", variables, env);

  const headerSegs = request.headers.map((h, n) => {
    const path = `headers[${n}]`;
    const segs = segment(h.value, path, variables, env);

    // CR, LF and NUL are refused by reqtrail, naming the field path AND the
    // variable that carried them. A runtime would throw on these, but the error
    // would arrive with no field path and no variable name — from a tool whose
    // entire purpose is saying where a value came from.
    const flat = probe(segs, env);
    if (/[\r\n\0]/.test(flat)) {
      const culprit = segs.find((s) =>
        s.kind !== "literal" && s.resolved &&
        /[\r\n\0]/.test(s.secret ? env[s.key] : s.value));
      if (culprit) {
        refuse("header.control", path,
          "the value of $reference contains CR, LF or NUL; this is a " +
          "header-injection attempt and is refused",
          { reference: culprit.written }, culprit.key ?? culprit.name);
      }
      refuse("header.control", path,
        "this header value contains CR, LF or NUL");
    }
    if (flat === "") warnings.push({ code: "header.empty", path, cause: "header value is empty" });
    if (flat !== flat.trim()) {
      warnings.push({ code: "header.whitespace", path,
        cause: "header value has leading or trailing whitespace" });
    }
    return { name: h.name, path, segs };
  });

  const collect = (segs, path) => {
    for (const s of segs) {
      if (s.kind === "literal") continue;
      if (!s.resolved) {
        unresolved.push({
          code: s.secret ? "env.unset" : "variable.undefined",
          path, reference: s.written,
          cause: s.secret
            ? `environment variable ${s.key} is not set`
            : `variable ${s.name} is not defined in this workspace`,
          variable: s.key ?? s.name,
        });
      } else if (s.secret && s.empty) {
        warnings.push({ code: "env.empty", path,
          cause: `environment variable ${s.key} is set but empty` });
      }
    }
  };
  collect(urlSegs, "url");
  for (const h of headerSegs) collect(h.segs, h.path);

  // Normalize the URL only when every span in it resolves. A URL containing an
  // unresolved reference is not the URL that would be sent, and running it
  // through the parser would display `%7B%7Bx%7D%7D` — a string nothing would
  // ever produce. Show what the file says instead, marked not normalized.
  const urlResolved = allResolved(urlSegs);
  let urlView;
  if (urlResolved) {
    const n = normalizeUrl(urlSegs, env, "url");
    urlView = { display: n.display, normalized: n.normalized, spans: n.spans };
    if (n.hadFragment) {
      warnings.push({ code: "url.fragment", path: "url",
        cause: "fragment dropped — fragments are never transmitted" });
    }
  } else {
    urlView = {
      display: masked(urlSegs), normalized: false,
      spans: urlSegs.filter((s) => s.kind !== "literal").map(() => ({
        determined: false, transformed: false,
      })),
    };
  }

  // ONE ROW PER OCCURRENCE, NOT PER VARIABLE: position determines
  // transformation, and the same value in a path and in a query can normalize
  // differently. Ordering follows the request — URL first, then headers in file
  // order — so the two views can be read against each other line by line.
  const provenance = [];
  let k = 0;
  for (const s of urlSegs) {
    if (s.kind === "literal") continue;
    const span = urlView.spans[k++];
    provenance.push(row("url", s, span, urlResolved && urlView.normalized));
  }
  for (const h of headerSegs) {
    for (const s of h.segs) {
      if (s.kind === "literal") continue;
      // Header values take no encoding, so a header span produces exactly what
      // was substituted.
      provenance.push(row(h.path, s,
        { determined: true, transformed: false, produced: s.secret ? undefined : s.value },
        false));
    }
  }

  return {
    request: { id: request.id, name: request.name },
    prepared: {
      method: request.method,
      url: urlView.display,
      headers: headerSegs.map((h) => ({ name: h.name, value: masked(h.segs) })),
    },
    urlNormalized: urlView.normalized,
    urlResolved,
    segments: {
      url: urlSegs.map(publicSegment),
      headers: headerSegs.map((h) => ({ name: h.name, value: h.segs.map(publicSegment) })),
    },
    provenance,
    warnings,
    unresolved,
    resolvable: unresolved.length === 0,
  };
}

function row(path, s, span, urlWasNormalized) {
  const out = {
    path, reference: s.written, source: s.source,
    secret: s.secret, resolved: s.resolved, empty: s.empty,
    transformed: span.transformed,
    determined: span.determined,
  };
  if (!s.resolved) return out;
  if (!s.secret) {
    out.substituted = s.value;
    if (span.determined && span.produced !== undefined) out.produced = span.produced;
  } else {
    // A secret span reports THAT its bytes changed, never what they became:
    // the transformation column cannot show `café → caf%C3%A9` without leaking
    // the value.
    out.produced = span.transformed ? `${MASK} (masked, normalized)` : `${MASK} (masked)`;
  }
  if (!span.determined && urlWasNormalized) out.note = "attribution undetermined";
  return out;
}

// The single core entry point. Adapters call this and render what comes back.
export function resolveWorkspace(text, { requestId, env, source } = {}) {
  const workspace = parseWorkspace(text, source ?? "workspace");
  const request = selectRequest(workspace, requestId);
  const result = prepareRequest(request, workspace.variables, env ?? {});
  return { schemaVersion: SCHEMA_VERSION, ...result };
}

export { SCHEMA_VERSION };
