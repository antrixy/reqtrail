// Errors are DATA, not prose. The core returns or throws a structure carrying a
// stable code, a field path and a cause; adapters render it.
//
// THE SHAPE IS THE GUARANTEE, and this is the correction made after the leak
// audit. Before it, `cause` was prose with values concatenated in — so a call
// site could write `"${str}" is not a valid URL`, an adapter received a finished
// sentence, and nothing downstream could tell a value from the words around it.
// Twenty of thirty-one call sites did exactly that; three put an environment
// secret onto four output channels, and nine put raw terminal control
// characters from a workspace file onto the terminal.
//
// Now a call site supplies a TEMPLATE — a string literal with `$name` slots and
// no interpolation — plus a values object. There is no string to bake a value
// into. Escaping happens HERE, once, where the Refusal is built, rather than at
// each call site: `decisions.md` forbids call-site masking, because a helper you
// have to remember to call is a habit and not a mechanism.
//
// Two classes, and the distinction is the exit-code split in SPEC:
//
//   Refusal    the prepared request cannot be built at all. Thrown.
//   Unresolved a reference has no value. NOT thrown — the prepared request is
//              still built and displayed, marked unresolved, and `resolve`
//              exits 1. Refusing to SHOW the request removes the diagnosis,
//              which is the product.

// C0 controls except tab and newline, DEL, and C1. JSON.stringify covers the C0
// range but leaves DEL and C1 alone, which is why this is not just
// JSON.stringify: a workspace file can carry either.
//
// CR WAS MISSING UNTIL 0.4.1, and this comment said "except tab and newline"
// the whole time. The range stopped at \u000c and resumed at \u000e, skipping
// \u000d, so a key like `x\rFAKE: all good` returned the cursor and overwrote
// the `reqtrail:` prefix. The leak audit could not see it because its oracle
// was a copy of this regex; it is now written from Unicode properties instead.
//
// ALSO ESCAPED SINCE 0.4.1: the bidi controls (U+061C, U+200E-U+200F,
// U+202A-U+202E, U+2066-U+2069), which reorder the display with no escape
// sequence, and the line and paragraph separators (U+2028-U+2029).
// ZWJ and ZWNJ (U+200C-U+200D) are NOT escaped: several scripts and every
// multi-part emoji need them, and they cannot reorder text.
// HONESTY-PATCH-PREREGISTRATION.md D2.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;

const hex = (c) => "\\u" + c.codePointAt(0).toString(16).padStart(4, "0");

// Escape without quoting. Used for field paths, which are read as identifiers.
export const escapeControls = (v) => String(v).replace(CONTROL, hex);

// Escape and quote. Used for every value rendered inside a message, so a value
// is visibly a value and an escape sequence is visibly text.
export const quote = (v) => `"${escapeControls(v).replace(/"/g, '\\"')}"`;

// Fill `$name` slots. Slot names are [a-z][A-Za-z0-9]* and the regex is greedy,
// so `$id` and `$idList` cannot be confused.
export function fill(template, values) {
  return template.replace(/\$([a-z][A-Za-z0-9]*)/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole);
}

export class Refusal extends Error {
  constructor({ code, path, template, values = {}, variable }) {
    // Values are escaped and quoted ONCE, here. `detail.values` therefore holds
    // safe strings, which matters because adapters serialize `detail` — an
    // unescaped values map would put the leak back through `--json`.
    const safe = {};
    for (const [k, v] of Object.entries(values)) safe[k] = quote(v);
    const message = fill(template, safe);

    super(message);
    this.name = "Refusal";
    this.detail = {
      code,
      path: escapeControls(path),
      cause: message,
      values: safe,
    };
    if (variable !== undefined) this.detail.variable = escapeControls(variable);
  }
}

export const refuse = (code, path, template, values, variable) => {
  throw new Refusal({ code, path, template, values, variable });
};

// A STARTUP failure is not a workspace refusal, and conflating them cost a
// user-visible defect: `reqtrail ui` with no built bundle constructed a Refusal
// with the pre-template signature, threw, and printed "internal error — this is
// a bug in reqtrail" while exiting 0. The user's file was fine and reqtrail
// said reqtrail was broken — the same failure sitting B fixed for bad schemas,
// reintroduced one layer over by a signature change made afterwards.
//
// Different type, because they need different things: a Refusal names a field
// path in the user's workspace, and this names something about the
// installation. There is no field path to give.
export class StartupFailure extends Error {
  constructor({ code, cause }) {
    super(cause);
    this.name = "StartupFailure";
    this.detail = { code, cause: escapeControls(cause) };
  }
}

export const failToStart = (code, cause) => {
  throw new StartupFailure({ code, cause });
};
