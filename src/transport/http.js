// THE TRANSPORT ADAPTER. It TRANSLATES the exact request; it does not build one.
//
// The distinction is the whole reason 0.2.0 shipped before this file existed.
// Anything here that INVENTS request content is a second construction path, and
// a second construction path falsifies the claim reqtrail makes — that what it
// shows is what goes out. So the rule this module is written to:
//
//   Every byte in the header block comes from `exact.headers`. This file adds
//   no header, drops no header, reorders nothing and rewrites no value.
//
// `wireHeaders` is pure and separately testable for exactly that reason. The
// I/O lives in `send`, which cannot be exercised without a socket; the property
// that matters can be.
//
// SECRET BYTES PASS THROUGH HERE. `h.value.text` is plaintext, which is correct
// and unavoidable — sending is what resolves them. P-CONTAIN is unchanged and
// applies: these bytes reach the socket and NOTHING else. No log, no error
// message, no returned field. `send` never puts a header value in a thrown
// error, and node's own header errors name the header but not its value.

import http from "node:http";
import https from "node:https";

// Flat `[name, value, name, value, ...]`. Measured 2026-09-08 against the raw
// receiver: node:http writes a flat array in the given order and preserves
// repeated names, interleaving across distinct names, name casing, and empty
// values.
//
// AN OBJECT CANNOT CARRY THIS and the failure is silent. `{"X-Tag": [...]}` and
// `{"x-tag": ...}` are two JS keys but one HTTP header, and node:http keeps the
// later one — four occurrences went in and two came out, with no error. That is
// the loss `slice0/run.mjs:14-17` had, and it is why this returns an array.
export function wireHeaders(exact) {
  const flat = [];
  for (const h of exact.headers) {
    flat.push(h.name, h.value.text);
  }
  return flat;
}

// The origin and target, read from the ALREADY-NORMALIZED exact URL. This
// parses; it does not normalize. `exact.url.text` is the output of the core's
// single normalization, so re-parsing it is idempotent — and if it ever is not,
// that is a defect in the core rather than something for this file to paper
// over, so nothing here re-encodes or repairs.
export function wireTarget(exact) {
  const u = new URL(exact.url.text);
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port,
    path: u.pathname + u.search,
  };
}

// The send. `http:` and `https:` only — anything else is refused here rather
// than quietly downgraded. The core already refuses other schemes, but `send`
// is exported and `run` is not the only way in.
//
// P-VERIFY (HTTPS-PREREGISTRATION §2, D2): `rejectUnauthorized: true` is passed
// EXPLICITLY. Node's default reads NODE_TLS_REJECT_UNAUTHORIZED, so `=0` in the
// environment would silently turn verification off; an explicit `true` wins
// over it (measured 2026-09-22). This is transport configuration, not request
// content — the header block rule above is untouched.
export function send(exact) {
  const t = wireTarget(exact);
  const tls = t.protocol === "https:";
  if (t.protocol !== "http:" && !tls) {
    const e = new Error(`transport.protocol:${t.protocol}`);
    e.code = "transport.protocol";
    throw e;
  }
  const headers = wireHeaders(exact);
  return new Promise((resolve, reject) => {
    const onResponse = (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode }));
    };
    const options = { hostname: t.hostname, port: t.port, path: t.path, method: exact.method, headers };
    const req = tls
      ? https.request({ ...options, rejectUnauthorized: true }, onResponse)
      : http.request(options, onResponse);
    // The error is passed through WITHOUT its message being rebuilt. node's
    // header errors name the header and not the value; re-wrapping is where a
    // value would get interpolated into a string, so nothing is re-wrapped.
    req.on("error", reject);
    req.end();
  });
}
