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

// The endpoint and target, READ from the exact request's `transport`, which the
// core derived from its one normalized href (EXACT-TRANSPORT-PREREGISTRATION.md
// D1, D2). This file parses nothing.
//
// Until 0.5.0 this was `wireTarget`, which re-parsed `exact.url.text` and
// rebuilt what to send from display text. Two things were lost on the way:
// the target was rebuilt as `pathname + search`, which drops a bare `?`
// (RT-A2), and the hostname kept its IPv6 brackets, which node treats as a DNS
// name and fails ENOTFOUND (RT-B2). A selftest check forbids `new URL(` and
// `urlToHttpOptions` in this file, so neither route back is open by accident.
//
// PURE, like `wireHeaders`, so selftest — which the mutation harness runs —
// can observe the translation without a socket.
export function wireOptions(exact) {
  const t = exact.transport;
  return {
    protocol: t.protocol,
    hostname: t.connectHostname,
    port: t.port,
    path: t.requestTarget,
    method: exact.method,
    headers: wireHeaders(exact),
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
  const { protocol, ...options } = wireOptions(exact);
  const tls = protocol === "https:";
  if (protocol !== "http:" && !tls) {
    const e = new Error(`transport.protocol:${protocol}`);
    e.code = "transport.protocol";
    throw e;
  }
  return new Promise((resolve, reject) => {
    const onResponse = (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode }));
    };
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
