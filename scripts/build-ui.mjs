// Builds the UI into dist/. Users execute the npm tarball, not the git tree,
// so the chain that matters is reviewed commit -> locked build -> inspected
// pack -> authenticated publish. Removing a build step shortens that chain
// without eliminating it, which is why a bundler is acceptable here and a CDN
// asset is not: nothing is fetched at runtime.

import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
  legalComments: "eof",
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

// THIRD-PARTY NOTICES, derived from the bundle rather than from a list somebody
// maintains. The package set comes out of esbuild's metafile, so a dependency
// that is added, removed or swapped changes this file automatically and cannot
// be forgotten.
//
// This exists because `legalComments: "none"` shipped React, react-dom and
// scheduler with no copyright notice at all. MIT requires the notice to travel
// with substantial copies, so the tarball was distributing code without its
// licence. The bundle now preserves the @license blocks too — both, because the
// bundle is minified and a notice nobody can find is a poor discharge of an
// obligation that exists to be readable.
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (m) packages.add(m[1]);
}

const notices = ["# Third-party notices", "",
  "reqtrail's browser bundle (`dist/app.js`) includes the packages below.",
  "Their licences are reproduced in full. reqtrail itself is MIT; see LICENSE.",
  "", "Generated from the build's own module graph, not from a maintained list.",
  ""];
for (const name of [...packages].sort()) {
  const dir = join(root, "node_modules", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const licenseFile = ["LICENSE", "LICENSE.md", "LICENCE"]
    .map((f) => join(dir, f)).find((f) => existsSync(f));
  if (!licenseFile) {
    console.error(`build refused: no licence file found for ${name}`);
    process.exit(1);
  }
  notices.push(`## ${name} ${pkg.version}`, "", "```",
    readFileSync(licenseFile, "utf8").trim(), "```", "");
}
writeFileSync(join(dist, "THIRD_PARTY_NOTICES.md"), notices.join("\n"));

const bytes = Object.values(result.metafile.outputs)[0].bytes;
writeFileSync(join(dist, "BUILD.txt"),
  `esbuild bundle of src/ui/main.jsx\n${bytes} bytes\n`);
console.log(`built dist/app.js (${bytes} bytes), notices for ${[...packages].sort().join(", ")}`);
