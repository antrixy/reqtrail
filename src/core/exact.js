// THE EXACT REQUEST, AND THE ONE FUNCTION THAT PROJECTS IT.
//
// Before this module, the core built two things independently: the normalizer
// produced a masked URL, and `prepareRequest` produced masked header values
// from the segment list. Both were correct, and neither was DERIVED from the
// other. That is the shape `SPEC.md` warns about — a view that can be right in
// every test and wrong on the one request that matters, invisibly, because both
// halves look correct in isolation.
//
// So there is now one private value carrying real bytes, and exactly one
// function turning it into the public view.
//
//   exactRequest   private. Carries secret bytes. NEVER returned, never
//                  serialized, never rendered, never logged.
//   project()      the ONLY producer of the public projection.
//
// WHY THE RANGES LIVE ON THE EXACT REQUEST rather than being recomputed by
// `project`. Masking a URL is not a function of the URL text: `new URL` may
// move, re-encode or reorder a secret's bytes, so which bytes came from a
// secret is knowable only during normalization, where the span attribution
// happens. If `project` recomputed them it would be a second attribution
// implementation — the same defect one layer down. It is handed the answer
// instead, and it does nothing but substitute.
//
// P-DERIVE, which `test/selftest.mjs` checks: the public projection is
// `project(exact)` for every input. There is no input from which a consumer
// obtains a public view that `project` would not produce from that same exact
// request. That is checkable; "we only build it once" was a habit.

import { MASK } from "./url.js";

// Replace each byte range with the mask, right to left so earlier offsets stay
// valid. Ranges are half-open, non-overlapping and sorted — `normalizeUrl`
// refuses overlapping secret ranges rather than masking them together, and
// header ranges are built by a single left-to-right walk.
export function maskRanges(text, ranges) {
  let out = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    out = out.slice(0, ranges[i].start) + MASK + out.slice(ranges[i].end);
  }
  return out;
}

// The exact string a segment list concatenates to, with the byte ranges that
// came from secrets. Concatenation is pure — no normalization, no re-encoding —
// so a secret span's bytes land where a left-to-right walk can compute. This is
// why header values need no attribution machinery and a NORMALIZED url does.
//
// Two callers: every header value, and a URL that could NOT be normalized
// because it holds an unresolved reference. The second is why this is not named
// for headers — an unnormalized URL is concatenated by exactly the same rule.
//
// The rendering here must agree with `probe()` in prepare.js, which is the
// string the control-character and charset scans measure. An unresolved
// reference contributes its WRITTEN form, which holds no secret; that is what
// makes an unresolved secret safe to show verbatim.
export function exactFromSegments(segs, env) {
  let text = "";
  const secretRanges = [];
  for (const s of segs) {
    const piece = s.kind === "literal" ? s.text
      : !s.resolved ? s.written
      : s.secret ? env[s.key]
      : s.value;
    if (s.kind !== "literal" && s.resolved && s.secret) {
      secretRanges.push({ start: text.length, end: text.length + piece.length });
    }
    text += piece;
  }
  return { text, secretRanges };
}

// The single projection. Pure: no env, no I/O, no ambient state, nothing but
// the exact request. A second construction path anywhere else is what the
// release exists to make impossible, and a mutant that adds one must die.
export function project(exact) {
  return {
    method: exact.method,
    url: maskRanges(exact.url.text, exact.url.secretRanges),
    headers: exact.headers.map((h) => ({
      name: h.name,
      value: maskRanges(h.value.text, h.value.secretRanges),
    })),
  };
}
