// Sitting A — the browser half of the UI security rows.
//
// Predictions are frozen in SITTING-A-PREREGISTRATION.md. Run deliberately,
// not on every commit: it needs a browser the package does not depend on.
//
//   npm install --no-save playwright-core
//   node test/sitting-browser.mjs
//
// CHROMIUM_PATH may be set if playwright-core cannot resolve a browser itself.

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createUiServer, newToken } from "../src/server/server.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "examples", "example.reqtrail.json");
const text = readFileSync(file, "utf8");
const SECRET = "s3cr3t-value-1234";
const dist = join(root, "dist");

const assets = new Map([
  ["/", { body: readFileSync(join(dist, "index.html")), type: "text/html; charset=utf-8" }],
  ["/app.js", { body: readFileSync(join(dist, "app.js")), type: "text/javascript; charset=utf-8" }],
  ["/app.css", { body: readFileSync(join(dist, "app.css")), type: "text/css; charset=utf-8" }],
]);

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("sitting A needs a browser: npm install --no-save playwright-core");
  process.exit(2);
}

const results = [];
const record = (id, verdict, observed) => results.push({ id, verdict, observed });

const token = newToken();
const ui = createUiServer({ text, file, token, assets, env: { API_TOKEN: SECRET } });
const port = await ui.listen();
const base = `http://127.0.0.1:${port}`;

// A second, ordinary server standing in for an attacker's page. It is a
// different origin to the browser and is not reqtrail.
const attacker = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>other origin</title><p>other origin</p>");
});
await new Promise((r) => attacker.listen(0, "127.0.0.1", r));
const attackerPort = attacker.address().port;

// What the server actually received, so Origin claims are read off the wire
// rather than off the browser's own report of itself.
const seen = [];
ui.server.prependListener("request", (req) => {
  seen.push({ method: req.method, url: req.url, host: req.headers.host,
    origin: req.headers.origin ?? null });
});

const executablePath = process.env.CHROMIUM_PATH ||
  (() => { try { return chromium.executablePath(); } catch { return undefined; } })();

const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--host-resolver-rules=MAP * 127.0.0.1"],
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // ---- B1: the application renders -------------------------------------
  await page.goto(`${base}/#token=${token}`, { waitUntil: "networkidle" });
  const wire = await page.textContent(".wire").catch(() => null);
  const rows = await page.$$eval(".prov tbody tr", (n) => n.length).catch(() => 0);
  record("B1",
    wire?.includes("GET https://api.example.com/users/42?q=a%20b") && rows === 4
      && pageErrors.length === 0
      ? "right" : "wrong",
    `wire=${JSON.stringify(wire?.split("\n")[0] ?? null)} provRows=${rows} ` +
    `pageErrors=${pageErrors.length}`);

  // ---- B2: Origin absent on the navigation -----------------------------
  const nav = seen.find((r) => r.url === "/" && r.method === "GET");
  record("B2", nav && nav.origin === null ? "right" : "wrong",
    `GET / origin=${JSON.stringify(nav?.origin)}`);

  // ---- B3: Origin present and exact on fetch ---------------------------
  const apiCalls = seen.filter((r) => r.url.startsWith("/api/"));
  record("B3",
    apiCalls.length > 0 && apiCalls.every((r) => r.origin === base) ? "right" : "wrong",
    `${apiCalls.length} api calls, origins=` +
    JSON.stringify([...new Set(apiCalls.map((r) => r.origin))]));

  // ---- B6: no secret in the DOM ----------------------------------------
  const html = await page.content();
  record("B6", !html.includes(SECRET) ? "right" : "wrong",
    `secret in DOM: ${html.includes(SECRET)}`);

  // ---- B7: no cookies --------------------------------------------------
  const cookie = await page.evaluate(() => document.cookie);
  const jar = await page.context().cookies();
  record("B7", cookie === "" && jar.length === 0 ? "right" : "wrong",
    `document.cookie=${JSON.stringify(cookie)} jar=${jar.length}`);

  // ---- B8: token stripped, reload without it fails ----------------------
  const shownUrl = page.url();
  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await page.textContent(".failure").catch(() => null);
  record("B8",
    !shownUrl.includes(token) && afterReload !== null ? "right" : "wrong",
    `addressBar=${JSON.stringify(shownUrl.replace(String(port), "PORT"))} ` +
    `reloadMessage=${JSON.stringify(afterReload)}`);

  // ---- B9: CSP blocks an injected inline script -------------------------
  const cspBlocked = await page.evaluate(() => new Promise((resolve) => {
    window.__ran = false;
    document.addEventListener("securitypolicyviolation", () => resolve("blocked"),
      { once: true });
    const s = document.createElement("script");
    s.textContent = "window.__ran = true;";
    document.body.appendChild(s);
    setTimeout(() => resolve(window.__ran ? "executed" : "did not run"), 300);
  }));
  record("B9", cspBlocked !== "executed" ? "right" : "wrong", `inline script: ${cspBlocked}`);

  // ---- B4: the rebinding endgame ---------------------------------------
  // localhost resolves to the loopback interface, so this request is
  // same-origin to the browser and carries a Host the server does not accept —
  // which is exactly the shape a rebound request has when it arrives.
  const page2 = await browser.newPage();
  await page2.goto(`http://localhost:${port}/#token=${token}`, { waitUntil: "domcontentloaded" });
  const body2 = await page2.content();
  const hostSeen = seen.filter((r) => r.host !== `127.0.0.1:${port}`);
  record("B4",
    body2.includes("bad-host") && !body2.includes("reqtrail<") ? "right" : "wrong",
    `hosts refused=${JSON.stringify([...new Set(hostSeen.map((h) => h.host))])} ` +
    `rendered=${JSON.stringify(body2.slice(0, 120).replace(/\s+/g, " "))}`);
  await page2.close();

  // ---- F1-F7: the refusal contract, and the DOM channel ------------------
  // Sitting A measured only workspaces that resolve, which is why a blank page
  // on every refusal survived it. These fixtures are the other half.

  const refusalCases = {
    F1: ["grammar refusal",
      { version: 1, requests: [{ id: "r", method: "GET", url: "https://a.example/{{ x }}" }] },
      {}, undefined, "grammar.whitespace"],
    F2: ["unknown request id",
      { version: 1, requests: [
        { id: "alpha", method: "GET", url: "https://a.example/" },
        { id: "beta", method: "GET", url: "https://b.example/" }] },
      {}, "no-such-id", "selection.unknown"],
    F6: ["a refusal carrying a secret",
      { version: 1, requests: [{ id: "r", method: "GET", url: "https://{{$env.T}}/" }] },
      { T: `bad host ${SECRET}` }, undefined, "url.invalid"],
  };

  for (const [id, [label, workspace, env, wanted, code]] of Object.entries(refusalCases)) {
    const tk = newToken();
    const srv = createUiServer({
      text: JSON.stringify(workspace), file: "f.json", token: tk, assets,
      env, requestId: wanted,
    });
    const p = await srv.listen();
    const page = await browser.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
    await page.goto(`http://127.0.0.1:${p}/#token=${tk}`, { waitUntil: "networkidle" });
    const body = await page.content();
    const text = (await page.textContent("body")).replace(/\s+/g, " ");
    const shown = await page.textContent(".refusal").catch(() => null);

    if (id === "F6") {
      record("F6", !body.includes(SECRET) && shown !== null ? "right" : "wrong",
        `secretInDom=${body.includes(SECRET)} refusalRendered=${shown !== null}`);
    } else {
      const ok = shown !== null && text.includes(code) && errs.length === 0;
      record(id, ok ? "right" : "wrong",
        `code=${text.includes(code)} pageErrors=${errs.length} ` +
        `shown=${JSON.stringify((shown ?? "").slice(0, 70))}`);
    }
    await page.close(); await srv.close();
  }

  // ---- F3: an empty request list -----------------------------------------
  {
    const tk = newToken();
    const srv = createUiServer({
      text: JSON.stringify({ version: 1, requests: [] }), file: "f.json",
      token: tk, assets, env: {} });
    const p = await srv.listen();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${p}/#token=${tk}`, { waitUntil: "networkidle" });
    const text = (await page.textContent("body")).replace(/\s+/g, " ");
    record("F3", text.includes("no requests") ? "right" : "wrong",
      `shows: ${JSON.stringify(text.slice(0, 90))}`);
    await page.close(); await srv.close();
  }

  // ---- F4: --request is honoured -----------------------------------------
  {
    const tk = newToken();
    const srv = createUiServer({
      text: JSON.stringify({ version: 1, requests: [
        { id: "alpha", method: "GET", url: "https://alpha.example/" },
        { id: "beta", method: "GET", url: "https://beta.example/" }] }),
      file: "f.json", token: tk, assets, env: {}, requestId: "beta" });
    const p = await srv.listen();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${p}/#token=${tk}`, { waitUntil: "networkidle" });
    const wire = await page.textContent(".wire").catch(() => "");
    const current = await page.textContent(".req.current").catch(() => "");
    record("F4", wire.includes("beta.example") ? "right" : "wrong",
      `selected=${JSON.stringify(current.trim())} wire=${JSON.stringify(wire.split("\n")[0])}`);
    await page.close(); await srv.close();
  }

  // ---- F7: can the stale-response race be provoked at all? ---------------
  // The guard is correct either way. What is at issue is whether this sitting
  // has earned the right to say the defect was real, so a build WITHOUT the
  // guard is what gets probed. It cannot be, from outside the page, without
  // controlling response order — recorded as NOT REACHED rather than counted.
  record("F7", "not reached",
    "the race needs control over response arrival order; not reachable from a " +
    "browser driving the real server");

  // ---- B5: a cross-origin page cannot read the API ----------------------
  const page3 = await browser.newPage();
  await page3.goto(`http://127.0.0.1:${attackerPort}/`, { waitUntil: "domcontentloaded" });
  const attempt = await page3.evaluate(async ([url, tok]) => {
    try {
      const r = await fetch(url, { headers: { authorization: `Bearer ${tok}` } });
      return { read: true, status: r.status, body: (await r.text()).slice(0, 60) };
    } catch (e) {
      return { read: false, error: String(e).slice(0, 80) };
    }
  }, [`${base}/api/session`, token]);
  const serverSaw = seen.filter((r) => r.origin === `http://127.0.0.1:${attackerPort}`);
  record("B5",
    attempt.read === false && serverSaw.length > 0 ? "right" : "wrong",
    `page=${JSON.stringify(attempt)} serverSawForeignOrigin=${serverSaw.length}`);
  await page3.close();
} finally {
  await browser.close();
  attacker.close();
  await ui.close();
}

const wrong = results.filter((r) => r.verdict === "wrong");
record("B10", wrong.length >= 1 ? "right" : "wrong",
  `${wrong.length} of B1-B9 wrong`);

// THE GATE, and the shape of it is the point.
//
// It used to trip only on B4-B7, so B1, B2, B3, B8 and B9 could fail in silence
// — five of nine predictions, including every one about whether the application
// works at all.
//
// The obvious repair, "fail on any wrong prediction", is wrong as stated, and
// predicting the collision was cheaper than discovering it: B10 is a
// META-prediction about this sitting's own error rate, so the better the work,
// the more certainly it is wrong and the more certainly a naive gate trips.
// A sitting cannot be gated on its own error rate. B10 is recorded and
// excluded, by name and with the reason attached.
const META = new Set(["B10"]);
const gating = results.filter((r) => r.verdict === "wrong" && !META.has(r.id));

console.log(`sitting A — chromium\n`);
for (const r of results) {
  console.log(`  ${r.id.padEnd(4)} ${r.verdict.toUpperCase().padEnd(6)} ${r.observed}`);
}
console.log(`\n${results.filter((r) => r.verdict === "right").length}/${results.length} predictions held`);
if (gating.length) {
  console.error(`\n  FAIL — ${gating.length} prediction(s) wrong: ` +
    gating.map((g) => g.id).join(", "));
}
process.exit(gating.length ? 1 : 0);
