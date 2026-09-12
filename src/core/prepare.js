// One construction site. One projection. Consumed by every renderer.
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
// CORRECTED AGAIN 2026-09-05, and the second correction is the instructive one.
// The replacement sentence said `src/core/url.js` is THE ONE PLACE a resolved
// secret exists. That is also false. Measured 2026-09-05: eight sites across
// three modules read `env[key]` —
//
//   grammar.js   nested-template check, set-but-empty check, plain()
//   prepare.js   probe(), the control-character scan, the charset scan
//   url.js       normalization, span attribution
//
// RE-MEASURED 2026-09-07 at the boundary split, AND THE NUMBER DID NOT IMPROVE:
// still eight sites, now across FOUR modules —
//
//   grammar.js   nested-template check, set-but-empty check, plain()
//   prepare.js   the control-character scan, the charset scan
//   url.js       normalization, span attribution
//   exact.js     exactFromSegments()
//
// `probe()` did not disappear; it MOVED into the exact request's construction,
// where the string it built is now kept instead of discarded. That is the
// prediction B5 made and it is held on its wording — but the count is the same
// and the module list got longer, which is worth stating plainly rather than
// reporting the move as a reduction.
//
// It is also why the containment rule below is written about OUTPUTS. Two
// releases have now touched this and the site count has not gone down once. A
// guarantee phrased as "only these modules" would have needed rewriting both
// times; the output property needed no change and stayed green throughout.
//
// A false absolute was replaced with a narrower false absolute, inside a
// correction whose subject was that an unchecked absolute is what hid a defect.
// The grep that disproves it is one command and it was not run.
//
// THE RULE THAT IS ACTUALLY TRUE, and it is testable rather than architectural:
// secret bytes exist transiently inside the core's private preparation, wherever
// a decision needs them, and NEVER in a public result, a rendered view, a
// refusal, a warning, a protocol response or a log. `test/leak-audit.mjs`
// checks exactly that across every refusal and every channel — which is why the
// leak audit stayed green through both wrong sentences. **Containment is a
// property of the outputs, not of the module list**, and stating it as a module
// list is what made it wrong twice.

import { refuse } from "./errors.js";
import { segment, allResolved } from "./grammar.js";
import { normalizeUrl, hostFromHref, MASK } from "./url.js";
import { exactFromSegments, project } from "./exact.js";
// THE TRANSPORT IS IMPORTED, NOT INJECTED, and the choice is worth stating.
//
// A `send` passed in by the caller would keep the core free of I/O, which is
// the usual reason to do it. It would also hand the EXACT REQUEST — real secret
// bytes — to a function the core did not write. The containment rule says
// secret bytes exist inside the core's private preparation and nowhere else; a
// callback seam makes "the core's private preparation" an open set that any
// adapter can extend, and a rule about an open set is not checkable.
//
// So the transport joins the core's private graph. `test/selftest.mjs` checks
// that no adapter imports it.
import { send } from "../transport/http.js";

// The set node:http accepts, established by exhaustive measurement over
// U+0000-U+10FF plus samples above. Written as an allowlist so that a character
// nobody thought about is refused rather than admitted.
const HEADER_VALUE_OK = /[\t\u0020-\u007e\u0080-\u00ff]/;
import { parseWorkspace, selectRequest, SCHEMA_VERSION } from "./parse.js";

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

  // A WORKSPACE MAY NOT DECLARE ITS OWN `Host`, and this is a refusal rather
  // than a warning or a silent de-duplication. reqtrail derives `Host` from the
  // URL; a second one on the wire is a request-smuggling shape, and which of
  // the two a given intermediary honours is exactly the kind of thing this
  // product exists not to leave to chance. The same reasoning refuses CR and LF
  // in header values.
  const declaredHost = request.headers.findIndex(
    (h) => h.name.toLowerCase() === "host");
  if (declaredHost !== -1) {
    refuse("header.host", `headers[${declaredHost}]`,
      "a workspace may not set the Host header; reqtrail derives it from the " +
      "URL, and sending two would be a request-smuggling shape");
  }

  const urlSegs = segment(request.url, "url", variables, env);

  const headerSegs = request.headers.map((h, n) => {
    const path = `headers[${n}]`;
    const segs = segment(h.value, path, variables, env);

    // WHAT THE TRANSPORT WILL ACCEPT, measured rather than recalled.
    // node:http's validateHeaderValue accepts tab, U+0020-U+007E and
    // U+0080-U+00FF, and rejects everything else — every other C0 control, DEL,
    // and everything from U+0100 up, which is all emoji.
    //
    // reqtrail refuses the same set, and the reason given is the FILE FORMAT
    // rather than the transport: a workspace that cannot be sent is one
    // reqtrail should not call sendable. Accepting now and refusing when `run`
    // lands would break files that worked, which is the asymmetry the version
    // field exists to protect against.
    //
    // CR, LF and NUL keep their own code. They are a header-injection attempt,
    // not a typo, and the remedy differs.
    // The exact header value and the control-character probe are THE SAME
    // STRING. It used to be computed here, scanned, and thrown away, while the
    // masked view was rebuilt from the segments independently. Now it is built
    // once, scanned, and kept as part of the exact request.
    const exactValue = exactFromSegments(segs, env);
    const flat = exactValue.text;
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
    const bad = [...flat].find((ch) => !HEADER_VALUE_OK.test(ch));
    if (bad !== undefined) {
      const culprit = segs.find((seg) =>
        seg.kind !== "literal" && seg.resolved &&
        [...(seg.secret ? env[seg.key] : seg.value)].some((ch) => !HEADER_VALUE_OK.test(ch)));
      const point = `U+${bad.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
      if (culprit) {
        refuse("header.charset", path,
          "the value of $reference contains $codepoint, which the transport " +
          "will not accept: header values may contain tab, U+0020-U+007E and " +
          "U+0080-U+00FF",
          { reference: culprit.written, codepoint: point },
          culprit.key ?? culprit.name);
      }
      refuse("header.charset", path,
        "this header value contains $codepoint, which the transport will not " +
        "accept: header values may contain tab, U+0020-U+007E and U+0080-U+00FF",
        { codepoint: point });
    }

    // ACCEPTED, and warned about, because it is a display-versus-sent gap
    // rather than a fault. Measured on a raw socket: `café` leaves as
    // 63 61 66 e9 — one Latin-1 byte, not UTF-8. A file authored in UTF-8
    // sends something its author did not intend, and the receiver usually sees
    // an invalid sequence. Refusing it would be reqtrail inventing policy;
    // saying nothing would be the failure this product exists to prevent.
    if (/[\u0080-\u00ff]/.test(flat)) {
      warnings.push({ code: "header.latin1", path,
        cause: "this header value contains characters above U+007F, which the " +
          "transport sends as single Latin-1 bytes rather than UTF-8" });
    }

    if (flat === "") warnings.push({ code: "header.empty", path, cause: "header value is empty" });
    if (flat !== flat.trim()) {
      warnings.push({ code: "header.whitespace", path,
        cause: "header value has leading or trailing whitespace" });
    }
    return { name: h.name, path, segs, exact: exactValue };
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
    urlView = {
      exact: { text: n.href, secretRanges: n.secretRanges },
      normalized: n.normalized, spans: n.spans,
    };
    if (n.hadFragment) {
      warnings.push({ code: "url.fragment", path: "url",
        cause: "fragment dropped — fragments are never transmitted" });
    }
  } else {
    // Not normalized, so concatenation is the whole rule and the same helper
    // the headers use applies. This branch used to call `masked()` directly,
    // which was a third place that knew how to hide a secret.
    urlView = {
      exact: exactFromSegments(urlSegs, env), normalized: false,
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

  // THE EXACT REQUEST. Private, carries real secret bytes, and is the only
  // thing the projection is built from. It is deliberately NOT part of the
  // returned object — see `resolveWorkspace` below, which is where the boundary
  // is enforced rather than merely intended.
  //
  // `origin` DISTINGUISHES WHAT THE USER WROTE FROM WHAT REQTRAIL DERIVED, and
  // it is on every header rather than only on the derived one. A field present
  // on some entries is read as an annotation; a field present on all of them is
  // a property of the document. Without it the projection would assert that the
  // user wrote a header they did not, in the one tool whose claim is that it
  // says where every value came from.
  //
  // `Host` is FIRST, matching convention, and is ABSENT when the URL does not
  // resolve — there is no normalized URL to derive it from in that branch, and
  // inventing one would be showing a request that could not be sent.
  const exactHeaders = headerSegs.map((h) => ({
    name: h.name, value: h.exact, origin: "workspace",
  }));
  if (urlResolved) {
    exactHeaders.unshift({
      name: "Host",
      value: hostFromHref(urlView.exact.text, urlView.exact.secretRanges, "url"),
      origin: "derived",
    });
  }

  const exact = {
    method: request.method,
    url: urlView.exact,
    headers: exactHeaders,
  };

  // THE PAIR, and the two halves are SIBLINGS rather than one nested in the
  // other. An earlier draft returned `{ exact, ...publicFields }`, which is one
  // spread away from putting secret bytes on stdout: any consumer writing
  // `{ ...result }` would have carried it. Siblings mean reaching the exact
  // request requires naming it, and naming it is what the checks look for.
  return {
    exact,
    view: {
      request: { id: request.id, name: request.name },
      projection: project(exact),
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
    },
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

// THE ONE CONSTRUCTION PATH. Returns the pair: the private exact request and
// the public view derived from it. Not exported — a use case is exported
// instead, so that adding `run` in 0.3.0 means adding a CONSUMER of this pair
// rather than a second way to build a request.
function prepareFromWorkspace(text, { requestId, env, source } = {}) {
  const workspace = parseWorkspace(text, source ?? "workspace");
  const request = selectRequest(workspace, requestId);
  return prepareRequest(request, workspace.variables, env ?? {});
}

// USE CASE: inspect. Consumes the pair and yields ONLY the public half.
//
// This is where the boundary is enforced rather than intended. `run` will be
// the second use case, consuming the SAME pair and reading `exact` — which is
// the whole point of the split, and the reason it ships before any transport
// code exists. If `run` had come first, the cheapest available move would have
// been to build a second request for sending, and two construction paths
// falsify the claim reqtrail makes.
export function inspect(text, options) {
  const { view } = prepareFromWorkspace(text, options);
  return { schemaVersion: SCHEMA_VERSION, ...view };
}

// The name every adapter already imports. `inspect` is what it does.
export const resolveWorkspace = inspect;

// A transport error's CODE and nothing else.
//
// MEASURED 2026-09-08, and this is the reason the function exists rather than
// `{ code: e.code }` at the call site: node's transport errors carry values in
// their prose.
//
//     getaddrinfo ENOTFOUND secret-host.invalid
//     connect ECONNREFUSED 127.0.0.1:1
//
// A secret can be the hostname — `http://{{$env.H}}/p` is a workspace reqtrail
// accepts and masks correctly everywhere else. Surfacing `e.message`, or
// copying `e.hostname`, `e.address` or `e.port`, would put it on a channel that
// did not exist before this release. Codes are symbolic and carry no value from
// the request, and the shape is CHECKED rather than the names being listed, so
// a code nobody anticipated is still safe or still refused.
const CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
function transportCode(e) {
  return typeof e?.code === "string" && CODE_SHAPE.test(e.code)
    ? e.code : "transport.failed";
}

// USE CASE: run. The SECOND consumer of the pair, and the reason the pair
// exists. It reads `exact`; `inspect` reads `view`; neither builds a request.
//
// It returns the same public document `inspect` does, plus what happened. The
// projection is present whether or not anything was sent, because the diagnosis
// is the product and withholding it on a failed send would remove exactly the
// information the user needs.
//
// NOTHING IS SENT WHEN A REFERENCE IS UNRESOLVED. `resolvable` already means
// "every reference has a value"; sending a request built around a literal
// `{{$env.NOPE}}` would be reqtrail transmitting something it just told the
// user is not a request.
//
// A NON-2xx RESPONSE IS A SUCCESSFUL SEND. 404 means the transport worked and
// the server answered. `sent` records whether bytes went out, not whether the
// user liked the answer — the same distinction the UI draws when a core refusal
// arrives as HTTP 200.
export async function run(text, options) {
  const { exact, view } = prepareFromWorkspace(text, options);
  const document = { schemaVersion: SCHEMA_VERSION, ...view };
  if (!view.resolvable) return { ...document, sent: false };

  // AN `https://` URL IS A REFUSAL, NOT A TRANSPORT FAILURE.
  //
  // It was a transport failure until 2026-09-08, and the code it produced was
  // EXIT 3 — documented as "send attempted and failed; nothing to edit; may be
  // transient". All three halves were wrong: `send` throws on the protocol
  // check BEFORE opening a socket, so nothing was attempted; the fix is one
  // character in the workspace file, so there is something to edit; and it is
  // not transient. **Every product example in the README uses HTTPS**, so the
  // first `run` a new user attempts hit it.
  //
  // It belongs HERE and not in `prepareRequest`, because `resolve` inspecting
  // an `https://` URL is correct and unchanged. The scheme is legal to show and
  // not yet legal to send. `send` keeps its own guard — it is exported and this
  // path is not the only way in — but nothing reaches it through `run`.
  if (new URL(exact.url.text).protocol !== "http:") {
    refuse("transport.unsupported", "url",
      "reqtrail cannot send https yet; it can show the request but not send it");
  }
  try {
    return { ...document, sent: true, response: await send(exact) };
  } catch (e) {
    return { ...document, sent: false, transport: { code: transportCode(e) } };
  }
}

// Exported for the P-DERIVE check ONLY. It returns secret bytes, and no
// adapter, renderer or protocol path may call it — `test/selftest.mjs` checks
// that no file outside the core names it.
export { prepareFromWorkspace as __prepareForTest };

export { SCHEMA_VERSION };
