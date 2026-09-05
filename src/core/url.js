// The URL is substituted VERBATIM and then parsed ONCE. The parsed form is
// authoritative for both display and send — display-before-normalize would make
// the claim false on most real inputs (nine of twelve slice-0 probe inputs were
// transformed).
//
// This module also answers "what did THIS span produce", which the provenance
// table needs and which is the product: {{q}} contributed `a b`, which became
// `a%20b`.
//
// HOW SPAN ATTRIBUTION IS DONE, AND WHY IT IS NOT A SECOND NORMALIZER.
// The normalized URL is produced once, from the real values. To learn what one
// span contributed, the same string is re-parsed with that one span replaced by
// a sentinel; the sentinel's neighbours in the normalized probe give a prefix
// and a suffix, and the span's produced bytes are the gap between them in the
// real normalized URL.
//
// **Every reported attribution is verified by exact reconstruction** —
// prefix + produced + suffix must equal the normalized URL byte for byte. An
// attribution that cannot be proved is reported as undetermined rather than
// guessed. Nothing here re-implements percent-encoding; `new URL` is the only
// encoder, exactly as in the send path.
//
// PLAINTEXT NEVER LEAVES THIS MODULE. Secrets are needed to normalize honestly
// — a key in a query string can be re-encoded — so the normalized URL is built
// with real values, then the byte ranges belonging to secret spans are masked
// before anything is returned. If a secret's range cannot be proved, the
// request is REFUSED rather than displayed, because displaying it would either
// leak the value or show a URL that is not the one that would be sent.

import { refuse } from "./errors.js";
import { plain } from "./grammar.js";

const MASK = "\u2022\u2022\u2022\u2022";

// A core absent from the raw string, so an occurrence count of 1 is meaningful.
function sentinelCore(raw) {
  for (let n = 3; ; n++) {
    const core = "z".repeat(n) + "0" + "z".repeat(n);
    if (!raw.includes(core)) return core;
  }
}

function parse(str, path) {
  let u;
  try {
    u = new URL(str);
  } catch {
    refuse("url.invalid", path, `"${str}" is not a valid absolute URL`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    refuse("url.scheme", path,
      `scheme "${u.protocol.slice(0, -1)}" is not http or https`);
  }
  // The fragment is excluded. `new URL()` keeps #frag in href, but fragments
  // are never transmitted — displaying href would show something that is not
  // sent, which is the exact defect this product exists to prevent.
  const hadFragment = u.hash !== "";
  u.hash = "";
  return { href: u.href, hadFragment };
}

// Returns { display, normalized, hadFragment, spans } where spans[i] describes
// substituted segment i: { determined, produced?, transformed }. `produced` is
// omitted for secret spans — the caller learns THAT the bytes changed, never
// what they became.
export function normalizeUrl(segs, env, path) {
  const raw = plain(segs, env);
  const { href, hadFragment } = parse(raw, path);
  const core = sentinelCore(raw + href);

  // Index within `segs` of each substituted segment, in order.
  const subs = [];
  segs.forEach((s, i) => { if (s.kind !== "literal") subs.push(i); });

  const results = [];
  const secretRanges = [];

  for (const idx of subs) {
    const seg = segs[idx];
    let out = { determined: false, transformed: false };

    // Two sentinel shapes. A span that supplies the scheme cannot be probed
    // bare — `zzz0zzz/users` is not an absolute URL — so a scheme-carrying
    // probe is tried too. A wrong choice cannot produce a wrong answer: the
    // reconstruction check below rejects it.
    for (const injected of ["", "https://", "http://"]) {
      const sentinel = injected + core;
      const probeRaw = segs
        .map((s, i) => (i === idx ? sentinel
          : s.kind === "literal" ? s.text
          : s.secret ? env[s.key] : s.value))
        .join("");

      let probeHref;
      try {
        const u = new URL(probeRaw);
        if (u.protocol !== "http:" && u.protocol !== "https:") continue;
        u.hash = "";
        probeHref = u.href;
      } catch { continue; }

      const at = probeHref.indexOf(core);
      if (at === -1 || probeHref.indexOf(core, at + 1) !== -1) continue;

      const prefix = probeHref.slice(0, at);
      const suffix = probeHref.slice(at + core.length);
      if (!prefix.endsWith(injected)) continue;
      const outer = prefix.slice(0, prefix.length - injected.length);

      if (!href.startsWith(outer) || !href.endsWith(suffix)) continue;
      if (outer.length + suffix.length > href.length) continue;
      const produced = href.slice(outer.length, href.length - suffix.length);
      // The reconstruction guarantee is carried by the TWO GUARDS ABOVE, not by
      // this line: given startsWith(outer), endsWith(suffix) and the length
      // check, the three pieces concatenate to `href` by construction. This
      // line is therefore a tautology and cannot fire — mutation testing found
      // it to be an equivalent mutant, and the comment that used to sit here
      // called it "the whole guarantee", which was wrong. Kept as an executable
      // statement of the invariant, recorded as unfalsifiable rather than
      // presented as a check.
      if (outer + produced + suffix !== href) continue;

      const substituted = seg.secret ? env[seg.key] : seg.value;
      out = { determined: true, transformed: produced !== substituted };
      if (seg.secret) {
        secretRanges.push({ start: outer.length, end: href.length - suffix.length });
      } else {
        out.produced = produced;
      }
      break;
    }

    if (seg.secret && !out.determined) {
      refuse("url.secret.undisplayable", path,
        `the URL cannot be displayed without revealing ${seg.written}: ` +
        "normalization moved or reshaped the secret's bytes and reqtrail " +
        "cannot prove which part of the URL came from it", seg.key);
    }
    results.push(out);
  }

  secretRanges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < secretRanges.length; i++) {
    if (secretRanges[i].start < secretRanges[i - 1].end) {
      refuse("url.secret.undisplayable", path,
        "two secret values overlap in the normalized URL and cannot be " +
        "masked independently");
    }
  }

  let display = href;
  for (let i = secretRanges.length - 1; i >= 0; i--) {
    const { start, end } = secretRanges[i];
    display = display.slice(0, start) + MASK + display.slice(end);
  }

  return { display, normalized: href !== raw, hadFragment, spans: results };
}

export { MASK };
