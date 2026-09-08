#!/usr/bin/env node
import { main, VERSION } from "../src/cli/main.js";

// No stack traces reach the user. An unexpected throw is a defect in reqtrail,
// and it says so rather than printing an internal path.
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(
    `reqtrail: internal error — this is a bug in reqtrail ${VERSION}.\n` +
    `  ${e && e.message ? e.message : String(e)}\n` +
    `  Please report it at https://github.com/antrixy/reqtrail/issues\n`);
  process.exitCode = 1;
}
