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

// The send. `node:https` is deliberately absent — 0.4.0, per
// TRANSPORT-PREREGISTRATION §5. It is one import away and every product example
// uses HTTPS, so its absence is stated rather than left to be noticed:
// a non-http: protocol is refused here rather than quietly downgraded.
export function send(exact) {
  const t = wireTarget(exact);
  if (t.protocol !== "http:") {
    const e = new Error(`transport.protocol:${t.protocol}`);
    e.code = "transport.protocol";
    throw e;
  }
  const headers = wireHeaders(exact);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: t.hostname, port: t.port, path: t.path, method: exact.method, headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      },
    );
    // The error is passed through WITHOUT its message being rebuilt. node's
    // header errors name the header and not the value; re-wrapping is where a
    // value would get interpolated into a string, so nothing is re-wrapped.
    req.on("error", reject);
    req.end();
  });
}
