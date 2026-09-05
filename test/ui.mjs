// The escaping guarantee is the reason React is here at all: an API client
// renders untrusted remote content constantly, and 0.2.0 introduces responses.
// Buying that guarantee and leaving `dangerouslySetInnerHTML` available would
// be paying for nothing, so the prohibition is TESTED.
//
// P11 WAS WRONG, AND THE PRE-REGISTRATION SAID WHAT TO DO IF IT WAS.
// The prediction was that the shipped bundle contains no occurrence of
// `dangerouslySetInnerHTML`. It contains one: react-dom implements the property
// and names it. **A grep of the shipped bundle can therefore never pass**, and
// had that check been written first it would have been quietly dropped for
// being "noisy" — leaving the prohibition untested while looking tested.
//
// The check that survives is a bundle of OUR SOURCE ONLY, with react and
// react-dom external. It covers every current and future file under src/ui
// without depending on anyone remembering to add it, and react's internals
// cannot mask a real use.

import { build, transform } from "esbuild";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const EXPECTED = 12;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ui = join(root, "src", "ui");
const dist = join(root, "dist");

let ran = 0;
const failures = [];
async function check(name, fn) {
  ran++;
  try {
    if ((await fn()) !== true) throw new Error("returned false");
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

const uiFiles = readdirSync(ui).map((f) => join(ui, f));
const uiSource = uiFiles.map((f) => readFileSync(f, "utf8")).join("\n");

// Our source, compiled, with react external. This is the real prohibition check.
const own = await build({
  entryPoints: [join(ui, "main.jsx")],
  bundle: true,
  write: false,
  format: "esm",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
  logLevel: "silent",
});
const ownBundle = own.outputFiles[0].text;

// Every UI file individually, COMMENTS STRIPPED — so a file that main.jsx does
// not yet import is still covered. Comments are stripped because the first
// version of this check failed on the comment in main.jsx that documents the
// prohibition: a raw grep cannot tell a use from a mention, and a check that
// makes documenting a rule impossible gets deleted rather than obeyed.
await check("no dangerouslySetInnerHTML in any UI file, comments excluded", async () => {
  for (const f of uiFiles) {
    if (!/\.[jt]sx?$/.test(f)) continue;
    const { code } = await transform(readFileSync(f, "utf8"),
      { loader: "jsx", jsx: "automatic" });
    if (code.includes("dangerouslySetInnerHTML")) return false;
  }
  return true;
});
await check("no dangerouslySetInnerHTML in a bundle of our source alone", () =>
  !ownBundle.includes("dangerouslySetInnerHTML"));
await check("the prohibition check can fail — a planted use is caught", async () => {
  const planted = await build({
    stdin: {
      contents: 'export const X = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />;',
      loader: "jsx", resolveDir: ui,
    },
    bundle: true, write: false, format: "esm", jsx: "automatic",
    external: ["react", "react/jsx-runtime"], logLevel: "silent",
  });
  return planted.outputFiles[0].text.includes("dangerouslySetInnerHTML");
});
// P11, recorded as measured. The shipped bundle DOES carry the string, so a
// grep of it is void as a check. Asserted in that direction so that if react
// ever stops naming the property, this file says so rather than silently
// gaining a check that means nothing.
await check("P11 WRONG — the shipped bundle does contain the string (react-dom)", () =>
  readFileSync(join(dist, "app.js"), "utf8").includes("dangerouslySetInnerHTML"));

await check("no innerHTML assignment in any UI file", () =>
  !/\.innerHTML\s*=/.test(uiSource));
await check("no eval or Function constructor in our bundle", () =>
  !/\beval\(/.test(ownBundle) && !/new Function\(/.test(ownBundle));
await check("no inline style attributes — the CSP forbids them", () =>
  !/style=\{/.test(uiSource) && !/ style="/.test(readFileSync(join(ui, "index.html"), "utf8")));
await check("no inline script in the shell", () => {
  const html = readFileSync(join(ui, "index.html"), "utf8");
  return !/<script(?![^>]*\bsrc=)/.test(html);
});
await check("the shell references only same-origin assets", () => {
  const html = readFileSync(join(ui, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  return refs.every((r) => r.startsWith("/"));
});
await check("the token is read from the fragment, never a query string", () =>
  uiSource.includes("window.location.hash") && !uiSource.includes("location.search"));
await check("the token is removed from the address bar after it is read", () =>
  uiSource.includes("history.replaceState"));
await check("the built bundle names no fetchable external origin", () => {
  const bundle = readFileSync(join(dist, "app.js"), "utf8");
  const origins = new Set(bundle.match(/https?:\/\/[a-z0-9.-]+/gi) ?? []);
  return [...origins].every((o) =>
    /^https?:\/\/(www\.w3\.org|react\.dev|127\.0\.0\.1|localhost)$/i.test(o));
});

if (failures.length) {
  console.error(`FAIL ${failures.length} of ${ran}`);
  for (const f of failures) console.error("  " + f);
}
if (ran !== EXPECTED) {
  console.error(`FAIL count tripwire: ran ${ran} checks, expected ${EXPECTED}`);
  process.exit(1);
}
if (failures.length) process.exit(1);
console.log(`ui ${ran}/${EXPECTED} OK`);
