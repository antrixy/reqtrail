// ONE PASS, NOT RECURSIVE. A {{...}} appearing inside a variable's VALUE is
// refused, never expanded.
//
// The reason is the claim, not simplicity: with one pass every substituted span
// has exactly one source and provenance is a flat map. With recursion a span
// has a chain and provenance becomes a tree, which is what makes it genuinely
// hard elsewhere. The enabling constraint is ONE HOP.
//
// SECRETS ARE NEVER MATERIALISED HERE. An environment segment carries the key
// and whether it is set; it does not carry the value. Nothing on the display
// side can leak what it does not hold.

import { refuse } from "./errors.js";

const NAME = /^[A-Za-z0-9_-]+$/;
const ENV = /^\$env\.[A-Za-z_][A-Za-z0-9_]*$/;

// Anything ambiguous is refused, because the layers underneath will not refuse
// it. Measured in slice 0: an unexpanded template never errors — it is mangled
// to %7B%7Bx%7D%7D in a path and passes through untouched in a query, a header
// and a HOST, so `https://{{host}}/a` would attempt a DNS lookup for a literal
// {{host}} with the user told nothing.
export function segment(input, path, vars, env) {
  const segs = [];
  let i = 0;

  while (i < input.length) {
    const open = input.indexOf("{{", i);
    if (open === -1) {
      segs.push({ kind: "literal", text: input.slice(i) });
      break;
    }
    if (open > i) segs.push({ kind: "literal", text: input.slice(i, open) });

    const close = input.indexOf("}}", open);
    if (close === -1) refuse("grammar.unmatched", path, 'unmatched "{{"');

    const ref = input.slice(open + 2, close);
    const written = `{{${ref}}}`;

    if (ref === "") refuse("grammar.empty", path, "empty variable name");
    if (ref !== ref.trim()) {
      refuse("grammar.whitespace", path,
        `whitespace inside ${written}; one canonical spelling`);
    }

    if (ENV.test(ref)) {
      const key = ref.slice(5);
      // 'KEY' in env, never truthiness. Missing and empty are different states
      // and the naive implementation conflates them.
      const set = Object.prototype.hasOwnProperty.call(env, key);
      if (set && env[key].includes("{{")) {
        refuse("grammar.nested", path,
          `the value of environment variable ${key} contains a template; ` +
          "resolution is single-pass", key);
      }
      segs.push({
        kind: "environment", written, key,
        source: "environment", secret: true,
        resolved: set, empty: set ? env[key] === "" : false,
      });
    } else if (NAME.test(ref)) {
      const defined = Object.prototype.hasOwnProperty.call(vars, ref);
      if (defined && vars[ref].includes("{{")) {
        refuse("grammar.nested", path,
          `the value of variable ${ref} contains a template; ` +
          "resolution is single-pass", ref);
      }
      segs.push({
        kind: "variable", written, name: ref,
        source: `variables.${ref}`, secret: false,
        resolved: defined, empty: defined ? vars[ref] === "" : false,
        ...(defined ? { value: vars[ref] } : {}),
      });
    } else {
      refuse("grammar.charset", path,
        `"${ref}" is not a valid variable name; ` +
        "collection variables are [A-Za-z0-9_-]+ and environment references " +
        "are $env. followed by [A-Za-z_][A-Za-z0-9_]*");
    }

    i = close + 2;
  }

  return segs;
}

// The three renderings of a segment list. Only `plain` can produce a secret,
// it takes env explicitly, and it is used ONLY inside the URL normalizer —
// never returned, never stored, never rendered.
export const plain = (segs, env) =>
  segs.map((s) => (s.kind === "literal" ? s.text
    : s.secret ? env[s.key]
    : s.value)).join("");

export const masked = (segs) =>
  segs.map((s) => (s.kind === "literal" ? s.text
    : !s.resolved ? s.written
    : s.secret ? "\u2022\u2022\u2022\u2022"
    : s.value)).join("");

export const allResolved = (segs) =>
  segs.every((s) => s.kind === "literal" || s.resolved);
