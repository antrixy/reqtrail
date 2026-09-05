// The CLI adapter owns argument parsing, formatting, stdout/stderr and exit
// codes. It resolves no variables, builds no request and interprets no file.
//
// Streams, forced by --json: stdout carries the payload, stderr carries errors,
// warnings and diagnostics. A warning on stdout would corrupt --json for any
// parser.
//
// Exit codes are INTERFACE from 0.1.0. Adding a code is allowed; changing an
// existing code's meaning is breaking. Callers should test != 0, not equality.
//
//   0  resolved completely
//   1  refused, or resolved with an unresolved reference — edit something
//   2  usage error — fix the command
//   3  send attempted and failed — UNREACHABLE in 0.1.0, nothing is sent

import { readFileSync } from "node:fs";
import { resolveWorkspace } from "../core/prepare.js";
import { Refusal } from "../core/errors.js";
import { renderResolve, renderDiagnostics, renderRefusal } from "./render.js";

export const VERSION = "0.1.0";

const USAGE = `reqtrail ${VERSION} — see the request before it is sent

  reqtrail resolve <file> [--request <id>] [--json]
  reqtrail ui <file> [--request <id>]
  reqtrail --version
  reqtrail --help

This release resolves and displays requests. It does not send them.

Exit codes: 0 resolved · 1 refused or unresolved · 2 usage.
Test != 0 rather than equality; codes may be added.
`;

class Usage extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === "--version" || command === "-v") return { command: "version" };
  if (command === "--help" || command === "-h" || command === undefined) {
    return { command: "help" };
  }
  if (command !== "resolve" && command !== "ui") {
    throw new Usage(`unknown command "${command}"`);
  }

  const opts = { command, file: undefined, requestId: undefined, json: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--json") {
      if (command !== "resolve") throw new Usage("--json applies to resolve only");
      opts.json = true;
    } else if (a === "--request") {
      opts.requestId = rest[++i];
      if (opts.requestId === undefined) throw new Usage("--request needs an id");
    } else if (a.startsWith("--request=")) {
      opts.requestId = a.slice("--request=".length);
    } else if (a.startsWith("-")) {
      throw new Usage(`unknown option "${a}"`);
    } else if (opts.file === undefined) {
      opts.file = a;
    } else {
      throw new Usage(`unexpected argument "${a}"`);
    }
  }
  if (opts.file === undefined) throw new Usage(`${command} needs a workspace file`);
  return opts;
}

function read(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    throw new Usage(`cannot read ${file}: ${e.code ?? e.message}`);
  }
}

export async function main(argv, io = process) {
  const out = (s) => io.stdout.write(s);
  const err = (s) => io.stderr.write(s);

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    err(`reqtrail: ${e.message}\n\n${USAGE}`);
    return 2;
  }

  if (opts.command === "help") { out(USAGE); return 0; }
  if (opts.command === "version") { out(`${VERSION}\n`); return 0; }

  let text;
  try {
    text = read(opts.file);
  } catch (e) {
    err(`reqtrail: ${e.message}\n`);
    return 2;
  }

  if (opts.command === "ui") {
    // Imported lazily so that `resolve` never loads the server, and so a
    // resolve-only user never has the loopback listener in their process.
    const { startUi } = await import("../server/server.js");
    try {
      return await startUi({ text, file: opts.file, requestId: opts.requestId, io });
    } catch (e) {
      // A bad workspace refuses here exactly as it does under `resolve`. It
      // used to escape this function entirely and print "internal error — this
      // is a bug", which told the user their file was fine and reqtrail was
      // broken.
      if (!(e instanceof Refusal)) throw e;
      err(renderRefusal(e.detail));
      return 1;
    }
  }

  try {
    const result = resolveWorkspace(text, {
      requestId: opts.requestId, env: io.env ?? process.env, source: opts.file,
    });
    if (opts.json) out(JSON.stringify(result, null, 2) + "\n");
    else out(renderResolve(result));
    err(renderDiagnostics(result));
    // resolve exits 1 when it cannot fully resolve WHILE STILL PRINTING
    // everything. Printing and the exit code are independent channels: the
    // human gets the diagnosis, the script gets "not sendable".
    return result.resolvable ? 0 : 1;
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    if (opts.json) err(JSON.stringify({ error: e.detail }, null, 2) + "\n");
    else err(renderRefusal(e.detail));
    return 1;
  }
}
