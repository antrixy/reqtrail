// Builds the UI into dist/. Users execute the npm tarball, not the git tree,
// so the chain that matters is reviewed commit -> locked build -> inspected
// pack -> authenticated publish. Removing a build step shortens that chain
// without eliminating it, which is why a bundler is acceptable here and a CDN
// asset is not: nothing is fetched at runtime.

import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "ui");
const dist = join(root, "dist");

mkdirSync(dist, { recursive: true });

const result = await build({
  entryPoints: [join(src, "main.jsx")],
  outfile: join(dist, "app.js"),
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2022"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

copyFileSync(join(src, "index.html"), join(dist, "index.html"));
copyFileSync(join(src, "app.css"), join(dist, "app.css"));

// The bundle must contain no network origin other than the one it is served
// from. A CDN reference smuggled in by a dependency would defeat the point of
// bundling at publish, so it is checked rather than assumed.
const bundle = readFileSync(join(dist, "app.js"), "utf8");
const origins = bundle.match(/https?:\/\/[a-z0-9.-]+/gi) ?? [];
// Two hosts are excluded knowingly and narrowly, each for a stated reason:
//   www.w3.org  react-dom carries the SVG, MathML and XHTML NAMESPACE URIs,
//               which are identifiers and are never fetched.
//   react.dev   react-dom embeds a documentation link in its error messages.
// Neither is loaded. The exclusions are written as an exact host list rather
// than by loosening the pattern, so the next new host still stops the build.
const external = origins.filter((o) =>
  !/^https?:\/\/(www\.w3\.org|react\.dev|127\.0\.0\.1|localhost)$/i.test(o));
if (external.length) {
  console.error("build refused: the bundle references external origins:");
  for (const o of new Set(external)) console.error("  " + o);
  process.exit(1);
}

const bytes = Object.values(result.metafile.outputs)[0].bytes;
writeFileSync(join(dist, "BUILD.txt"),
  `esbuild bundle of src/ui/main.jsx\n${bytes} bytes\n`);
console.log(`built dist/app.js (${bytes} bytes)`);
