// Crudest thing that can produce a prepared request. NOT product code.
// Implements only what the comparison needs, per SPEC's settled contracts.
//
// SECRETS STAY REFERENCES. A header value is a list of SEGMENTS; a secret
// segment holds the env key, never the value. render() masks, materialize()
// resolves. If this were flattened to a string here, P10 could not be tested —
// the plaintext would already exist on the display side.

const NAME = /^[A-Za-z0-9_-]+$/;
const ENV  = /^\$env\.[A-Za-z_][A-Za-z0-9_]*$/;

export class Refused extends Error {
  constructor(code, path, msg) { super(msg); this.code = code; this.path = path; }
}

// ONE PASS. A {{...}} inside a variable's VALUE is refused, not expanded.
function segment(input, path, vars, env) {
  const segs = [];
  let i = 0;
  while (i < input.length) {
    const open = input.indexOf("{{", i);
    if (open === -1) { if (i < input.length) segs.push({ lit: input.slice(i) }); break; }
    if (open > i) segs.push({ lit: input.slice(i, open) });
    const close = input.indexOf("}}", open);
    if (close === -1) throw new Refused(1, path, `unmatched "{{"`);
    const ref = input.slice(open + 2, close);
    if (ref === "") throw new Refused(1, path, "empty variable name");
    if (ref !== ref.trim()) throw new Refused(1, path, `whitespace in "{{${ref}}}"`);

    if (ENV.test(ref)) {
      const key = ref.slice(5);
      if (!(key in env)) throw new Refused(1, path, `environment variable ${key} is not set`);
      if (env[key].includes("{{")) throw new Refused(1, path, `value of ${key} contains a template`);
      segs.push({ ref: `{{${ref}}}`, envKey: key, source: "environment", secret: true });
    } else if (NAME.test(ref)) {
      if (!(ref in vars)) throw new Refused(1, path, `variable ${ref} is not defined`);
      if (vars[ref].includes("{{")) throw new Refused(1, path, `value of ${ref} contains a template; resolution is single-pass`);
      segs.push({ ref: `{{${ref}}}`, value: vars[ref], source: `variables.${ref}`, secret: false });
    } else {
      throw new Refused(1, path, `"${ref}" is not a valid variable name`);
    }
    i = close + 2;
  }
  return segs;
}

const plain  = (segs, env) => segs.map(s => s.lit ?? (s.secret ? env[s.envKey] : s.value)).join("");
const masked = (segs)      => segs.map(s => s.lit ?? (s.secret ? "\u2022\u2022\u2022\u2022" : s.value)).join("");

export function prepare(req, vars, env) {
  // URL: substituted verbatim, then normalized ONCE. The normalized form is
  // authoritative for both display and send.
  const urlSegs = segment(req.url, "url", vars, env);
  const rawUrl = plain(urlSegs, env);
  let u; try { u = new URL(rawUrl); } catch { throw new Refused(1, "url", `not a valid URL`); }
  const warnings = [];
  if (u.hash) { u.hash = ""; warnings.push({ path: "url", msg: "fragment dropped — never transmitted" }); }
  const url = u.href;

  const headers = req.headers.map((h, n) => {
    const path = `headers[${n}]`;
    const segs = segment(h.value, path, vars, env);
    const probe = plain(segs, env);
    if (/[\r\n\0]/.test(probe)) throw new Refused(1, path, "CR, LF or NUL in header value");
    if (segs.length === 0) warnings.push({ path, msg: "empty header value" });
    return { name: h.name, segs, path };
  });

  const spans = [...urlSegs.map(s => ({ ...s, path: "url" })),
                 ...headers.flatMap(h => h.segs.map(s => ({ ...s, path: h.path })))]
                 .filter(s => s.ref);

  return {
    method: req.method, url, headers, spans, warnings,
    urlNormalized: rawUrl !== url,
    render: () => ({ method: req.method, url,
                     headers: headers.map(h => ({ name: h.name, value: masked(h.segs) })) }),
    materialize: () => ({ method: req.method, url,
                     headers: headers.map(h => ({ name: h.name, value: plain(h.segs, env) })) }),
  };
}
