// The loopback API is the trust boundary. A browser cannot call the core; it
// calls this server, which calls the core, and every mitigation lives here.
//
// `reqtrail ui` is by construction a local service that reads a workspace and
// returns prepared requests. If a web page could drive it, that is an
// internal-network primitive. The attack is DNS REBINDING: a malicious site
// resolves its own hostname to 127.0.0.1, and from the browser's view its
// script is then same-origin. Origin protections do not help. The Host and
// Origin checks below are the specific defence, because a rebound request still
// carries the attacker's hostname.
//
// THE SEVEN UI SECURITY ROWS (SPEC "The UI shell") — these are the condition of
// choosing a web UI, not hardening:
//   1 bind 127.0.0.1 only            5 no CORS allowances, ever
//   2 random high port               6 the server dies with the CLI process
//   3 per-session bearer token       7 output DOM-escaped (React; no
//     (NOT a cookie)                   dangerouslySetInnerHTML, and the
//   4 exact Origin AND Host check      prohibition is tested)
//
// THE TEN SERVER PROTECTION ROWS. Choosing node:http over a framework does not
// remove the need for what a framework provides — it TRANSFERS it here:
//   1 max header count and size      6 exact route and method matching
//   2 max JSON body size             7 uniform JSON errors
//   3 request timeout                8 no stack traces to the browser
//   4 slow-upload timeout            9 graceful shutdown
//   5 content-type rejection        10 authenticate before reading a body
//
// Static delivery never converts a URL path into a filesystem path: assets are
// a Map from exact route to bytes, loaded at startup. Traversal, percent-encoded
// traversal and symlink behaviour are irrelevant rather than defended against.

import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveWorkspace } from "../core/prepare.js";
import { parseWorkspace } from "../core/parse.js";
import { Refusal } from "../core/errors.js";

export const LIMITS = {
  maxHeaderSize: 16 * 1024,   // row 1 — total header block
  maxHeaderCount: 64,         // row 1 — count
  maxBodyBytes: 64 * 1024,    // row 2
  requestTimeoutMs: 10_000,   // row 3
  headersTimeoutMs: 5_000,    // row 4
  bodyReadTimeoutMs: 5_000,   // row 4 — slow upload
  // MEASURED, and rows 3 and 4 do not hold without it. `requestTimeout` and
  // `headersTimeout` are enforced by a poller whose default interval is 30s, so
  // setting a 5s header timeout and stopping there buys a timeout that fires up
  // to 30s late. Setting the two timeouts is the obvious half of the row and is
  // not the whole row.
  connectionsCheckingIntervalMs: 1_000,
};

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "dist");

function loadAssets() {
  const read = (name) => {
    try {
      return readFileSync(join(dist, name));
    } catch {
      throw new Refusal({
        code: "ui.not-built", path: "dist",
        cause: `${name} is missing; run "npm run build:ui" before "reqtrail ui" ` +
          "in a source checkout (published packages ship it built)",
      });
    }
  };
  return new Map([
    ["/", { body: read("index.html"), type: "text/html; charset=utf-8" }],
    ["/app.js", { body: read("app.js"), type: "text/javascript; charset=utf-8" }],
    ["/app.css", { body: read("app.css"), type: "text/css; charset=utf-8" }],
  ]);
}

// Row 7: uniform JSON errors. Row 8: no stack traces, ever.
function fail(res, status, code, message) {
  const body = Buffer.from(JSON.stringify({ error: { code, message } }));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    // A local tool's responses have no business being embedded or sniffed.
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; script-src 'self'; " +
      "style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
  res.end(body);
}

function send(res, status, type, body) {
  res.writeHead(status, {
    "content-type": type,
    "content-length": body.length,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; script-src 'self'; " +
      "style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
  res.end(body);
}

function constantEquals(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

// Row 2 + row 4: bounded body with its own deadline, so a slow upload cannot
// hold a connection open for the whole request timeout.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => reject(new Error("slow")), LIMITS.bodyReadTimeoutMs);
    const done = (fn, v) => { clearTimeout(timer); fn(v); };
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        // Pause rather than destroy: destroying here resets the connection
        // before the 413 is written, and the client sees a transport failure
        // instead of the reason. The socket is closed after the response.
        req.pause();
        done(reject, new Error("too-large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => done(resolve, Buffer.concat(chunks).toString("utf8")));
    req.on("error", (e) => done(reject, e));
  });
}

// `env` is passed in, not read from process state inside the handler. The
// parity test found this: the two adapters disagreed because one read ambient
// process state and the other was given an environment explicitly. The
// environment is INPUT, and a session's input should not be able to change
// under it while the server is running.
export function createUiServer({ text, file, token, assets, env, requestId }) {
  // Aliased deliberately. `handle()` declares its own `const requestId` further
  // down, and a const declaration shadows the whole function scope from the
  // top — so reading the outer one earlier in the same function throws a
  // ReferenceError from the temporal dead zone. It surfaced as a blank 500 with
  // no explanation, which is the next comment's subject.
  const preselect = requestId ?? null;
  const state = { port: null };

  const server = http.createServer({
    maxHeaderSize: LIMITS.maxHeaderSize,
    connectionsCheckingInterval: LIMITS.connectionsCheckingIntervalMs,
  },
    async (req, res) => {
      try {
        await handle(req, res);
      } catch (e) {
        // Row 8. The browser learns that something failed and nothing else.
        //
        // But the OPERATOR is not the browser. Swallowing the error entirely
        // cost an hour on a temporal-dead-zone ReferenceError that presented as
        // a blank 500: the row says do not return stack traces to the page, not
        // that the person running the process should be kept in the dark. The
        // stack goes to this process's stderr, which is the terminal the user
        // started `reqtrail ui` in and is not a channel the page can read.
        process.stderr.write(
          `reqtrail ui: internal error handling ${req.method} ${req.url}\n` +
          `${e && e.stack ? e.stack : String(e)}\n`);
        if (!res.headersSent) fail(res, 500, "internal", "internal error");
        else res.destroy();
      }
    });

  async function handle(req, res) {
    const expectedHost = `127.0.0.1:${state.port}`;
    const expectedOrigin = `http://${expectedHost}`;

    // Row 4 (UI): Host AND Origin, on EVERY request including static assets.
    // A rebound request still carries the attacker's hostname, so the Host
    // check is the one that catches it.
    if (req.headers.host !== expectedHost) {
      return fail(res, 403, "bad-host", "host not permitted");
    }
    // MEASURED IN SITTING A, and the design changed because of it. Prediction
    // B3 said `Origin` would be present on every fetch the application makes.
    // It is not: Chromium sends no `Origin` on a same-origin GET, so an
    // Origin check on a GET endpoint permits an absent header and therefore
    // checks nothing. Two consequences, both applied here:
    //
    //   * the API accepts POST only, so a browser always attaches `Origin`;
    //   * on /api/*, `Origin` must be PRESENT and exact — absent is refused.
    //
    // Static routes still allow an absent `Origin`, because a top-level
    // navigation has none (B2, measured right) and there is nothing to read
    // there anyway.
    const origin = req.headers.origin;
    const isApi = (req.url ?? "").startsWith("/api/");
    if (isApi ? origin !== expectedOrigin
              : origin !== undefined && origin !== expectedOrigin) {
      return fail(res, 403, "bad-origin", "origin not permitted");
    }

    // Row 1: header count. maxHeaderSize covers total size at the parser.
    if (req.rawHeaders.length / 2 > LIMITS.maxHeaderCount) {
      return fail(res, 431, "too-many-headers", "too many headers");
    }

    const url = req.url ?? "";
    // Row 6: exact METHOD /path. The query string is not part of dispatch and
    // is not accepted — every parameter this API takes travels in a JSON body.
    const path = url;

    if (assets.has(path)) {
      if (req.method !== "GET") return fail(res, 405, "method", "method not allowed");
      const a = assets.get(path);
      return send(res, 200, a.type, a.body);
    }

    if (path === "/api/session" || path === "/api/resolve") {
      // POST for both, including the read-only one. A GET would be reachable
      // without an `Origin` header; see the note above.
      if (req.method !== "POST") return fail(res, 405, "method", "method not allowed");

      // Row 10: authenticate BEFORE reading a body. An unauthenticated caller
      // never gets to spend our memory.
      const auth = req.headers.authorization ?? "";
      const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!constantEquals(presented, token)) {
        return fail(res, 401, "unauthorized", "missing or invalid session token");
      }

      // Row 5 (server): reject unsupported content types.
      const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (ct !== "application/json") {
        return fail(res, 415, "content-type", "expected application/json");
      }

      if (path === "/api/session") {
        const ws = parseWorkspace(text, file);
        return send(res, 200, "application/json; charset=utf-8",
          Buffer.from(JSON.stringify({
            file,
            requestId: preselect,
            requests: ws.requests.map((r) => ({ id: r.id, name: r.name })),
          })));
      }

      let raw;
      try {
        raw = await readBody(req, LIMITS.maxBodyBytes);
      } catch (e) {
        if (e.message === "too-large") {
          res.on("finish", () => req.destroy());
          return fail(res, 413, "too-large", "body too large");
        }
        return fail(res, 408, "timeout", "request body timed out");
      }

      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return fail(res, 400, "bad-json", "body is not valid JSON");
      }
      const requestId = body && typeof body.requestId === "string"
        ? body.requestId : undefined;

      try {
        const result = resolveWorkspace(text, { requestId, env, source: file });
        // The SAME structure the CLI renders. The adapter formats nothing.
        return send(res, 200, "application/json; charset=utf-8",
          Buffer.from(JSON.stringify(result, null, 2) + "\n"));
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        return send(res, 200, "application/json; charset=utf-8",
          Buffer.from(JSON.stringify({ error: e.detail }, null, 2) + "\n"));
      }
    }

    return fail(res, 404, "not-found", "not found");
  }

  // Rows 3 and 4: node's defaults are 300s and 60s, which are far too
  // permissive for a loopback tool with a known client.
  server.requestTimeout = LIMITS.requestTimeoutMs;
  server.headersTimeout = LIMITS.headersTimeoutMs;
  server.keepAliveTimeout = 5_000;

  return {
    server,
    listen: () => new Promise((resolve) => {
      // Rows 1 and 2 (UI): loopback only, random high port.
      server.listen(0, "127.0.0.1", () => {
        state.port = server.address().port;
        resolve(state.port);
      });
    }),
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

export function newToken() {
  // Row 3 (UI): a per-session bearer token, NOT a cookie — cookies are attached
  // cross-site by the browser, which is exactly the property being defended
  // against. Carried in the URL FRAGMENT, which browsers never send to a
  // server, so it appears in no log and no Referer.
  return randomBytes(32).toString("base64url");
}

export async function startUi({ text, file, requestId, io = process }) {
  // Refuses early and identically to any other refusal.
  parseWorkspace(text, file);

  const token = newToken();
  // Captured once, for the lifetime of the session.
  const ui = createUiServer({
    text, file, token, assets: loadAssets(), env: { ...process.env }, requestId,
  });
  const port = await ui.listen();

  io.stdout.write(
    `reqtrail ui — read only, nothing is sent\n` +
    `  http://127.0.0.1:${port}/#token=${token}\n` +
    `  bound to 127.0.0.1 only · session token expires when this process does\n` +
    `  Ctrl-C to stop\n`);

  // Row 9 / UI row 6: the server dies with the CLI process. No daemon, no
  // background listener outliving the terminal.
  return new Promise((resolve) => {
    const stop = async () => { await ui.close(); resolve(0); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
