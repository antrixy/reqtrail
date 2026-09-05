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
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

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
