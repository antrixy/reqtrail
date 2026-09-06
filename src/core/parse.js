// Parse and validate a workspace file. Every refusal names a FIELD PATH and a
// stable code; the adapter renders them.
//
// Decisions settled here, from SPEC's "non-blocking — settle while building"
// list. Each is recorded at the point it is enforced.

import { refuse } from "./errors.js";

const SCHEMA_VERSION = 1;
const ID = /^[A-Za-z0-9._-]+$/;
// The same charset the grammar accepts inside {{...}}. Kept beside the id rule
// so a change to one is visibly a change to the other.
const VARIABLE_NAME = /^[A-Za-z0-9_-]+$/;
// RFC 9110 token.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// DUPLICATE MEMBERS. `JSON.parse` is last-wins by specification, so
// {"url": "a", "url": "b"} parses to "b" and nothing says so. For a product
// whose subject is that there will be no surprises about what gets sent, two
// files that differ in a way that matters must not parse identically in
// silence — the same argument that refused first-wins for duplicate request ids.
//
// Run AFTER JSON.parse has succeeded, so this scanner may assume well-formed
// input and stays small. It reports the field path of the second occurrence.
function findDuplicateMember(text) {
  let i = 0;
  const stack = [];
  let expectKey = false;

  // The path of the slot a new container is about to occupy: the key just read
  // if the parent is an object, or `parent[n]` if it is an array.
  const slotPath = () => {
    const parent = stack[stack.length - 1];
    if (!parent) return "";
    return parent.array ? `${parent.path}[${parent.index}]` : parent.pending;
  };

  const readString = () => {
    let out = "";
    i++;
    while (text[i] !== '"') {
      if (text[i] === "\\") {
        const c = text[++i];
        out += c === "u"
          ? String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16))
          : { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" }[c] ?? c;
        if (c === "u") i += 4;
      } else out += text[i];
      i++;
    }
    i++;
    return out;
  };

  while (i < text.length) {
    const c = text[i];
    if (c === "{") {
      stack.push({ keys: new Set(), path: slotPath() });
      expectKey = true;
      i++;
    } else if (c === "[") {
      stack.push({ array: true, index: 0, path: slotPath() });
      expectKey = false;
      i++;
    } else if (c === "}" || c === "]") {
      stack.pop();
      expectKey = false;
      i++;
    } else if (c === ",") {
      const top = stack[stack.length - 1];
      if (top?.array) top.index++;
      expectKey = Boolean(top && !top.array);
      i++;
    } else if (c === '"') {
      const top = stack[stack.length - 1];
      if (expectKey && top && !top.array) {
        const key = readString();
        const path = top.path ? `${top.path}.${key}` : key;
        if (top.keys.has(key)) return { path, key };
        top.keys.add(key);
        top.pending = path;
        expectKey = false;
      } else {
        readString();
      }
    } else i++;
  }
  return null;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Unknown keys are REFUSED rather than ignored. The asymmetry that governs the
// variable charset governs this too: relaxing later breaks nothing, and a
// silently ignored key is a setting the user believes is in effect.
function only(obj, allowed, path) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      refuse("schema.unknown-key", `${path}.${key}`,
        "unknown key $key; allowed here: $allowed",
        { key, allowed: allowed.join(", ") });
    }
  }
}

function str(obj, key, path) {
  const v = obj[key];
  if (typeof v !== "string") {
    refuse("schema.type", `${path}.${key}`,
      "expected a string, got $got",
      { got: v === undefined ? "nothing" : typeof v });
  }
  return v;
}

export function parseWorkspace(text, source = "workspace") {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    // The runtime's own description of the file. Escaped like any other
    // value, but NOT quoted as one: it is a sentence rather than a field, and
    // quoting it would read as though the file contained that text.
    refuse("schema.json", source, "file is not valid JSON: $reason",
      { reason: e.message });
  }
  if (!isPlainObject(doc)) refuse("schema.type", source, "expected a JSON object");

  const dup = findDuplicateMember(text);
  if (dup) {
    refuse("schema.duplicate-member", dup.path,
      "the key $key appears more than once in this object; JSON keeps the " +
      "last one silently, so two files that behave differently would look the " +
      "same", { key: dup.key });
  }

  only(doc, ["version", "variables", "requests"], "");

  // A shipped binary must REFUSE a version it does not recognise rather than
  // attempt a best-effort read. Three lines now; unfixable in already
  // distributed binaries later. The number, not the string — one spelling.
  if (!("version" in doc)) {
    refuse("schema.version.missing", "version",
      "required; this build understands schema version $version",
      { version: SCHEMA_VERSION });
  }
  if (doc.version !== SCHEMA_VERSION) {
    refuse("schema.version.unknown", "version",
      "schema version $found is not recognised; this build understands " +
      "version $version",
      { found: doc.version, version: SCHEMA_VERSION });
  }

  // `variables` is optional and defaults to {}. A file with no variables is a
  // valid file, and requiring the key is ceremony rather than safety — nothing
  // is ambiguous about its absence.
  const variables = Object.create(null);
  if ("variables" in doc) {
    if (!isPlainObject(doc.variables)) {
      refuse("schema.type", "variables", "expected an object of name to string");
    }
    for (const [name, value] of Object.entries(doc.variables)) {
      // A variable that cannot be referenced is a variable that does nothing,
      // and a file whose author believes otherwise is exactly the surprise this
      // product exists to remove. The charset is the grammar's, so the two
      // cannot drift apart.
      if (!VARIABLE_NAME.test(name)) {
        refuse("schema.variable.charset", `variables.${name}`,
          "$name cannot be referenced: collection variable names are " +
          "[A-Za-z0-9_-]+, so no {{...}} can name this variable", { name });
      }
      if (typeof value !== "string") {
        refuse("schema.type", `variables.${name}`,
          "expected a string, got $got; values are substituted verbatim and " +
          "are not converted",
          { got: typeof value });
      }
      variables[name] = value;
    }
  }

  // `requests` is required and must be an array. An EMPTY array is accepted
  // here and refused at selection: an empty list is a well-formed file being
  // edited toward its first request, and the useful message is "this file
  // contains no requests", which selection gives.
  if (!Array.isArray(doc.requests)) {
    refuse("schema.type", "requests", "expected an array of requests");
  }

  const seen = new Set();
  const requests = doc.requests.map((r, n) => {
    const path = `requests[${n}]`;
    if (!isPlainObject(r)) refuse("schema.type", path, "expected an object");
    only(r, ["id", "name", "method", "url", "headers"], path);

    const id = str(r, "id", path);
    if (!ID.test(id)) {
      refuse("schema.id.charset", `${path}.id`,
        "$id is not a valid request id; ids are [A-Za-z0-9._-]+", { id });
    }
    // Duplicate ids are REFUSED, not first-wins. First-wins picks a winner the
    // file does not express, which is the failure recorded against overlapping
    // profiles in HeaderWright: two configurations that behave differently and
    // no way to see which one you have.
    if (seen.has(id)) {
      refuse("schema.id.duplicate", `${path}.id`,
        "request id $id is used more than once; ids must be unique", { id });
    }
    seen.add(id);

    // `name` is optional and is display only — it never selects a request.
    if ("name" in r) str(r, "name", path);

    // GET only in 0.1.0, and stated explicitly in the file rather than
    // defaulted: when another verb arrives, an existing file must not change
    // meaning.
    const method = str(r, "method", path);
    if (method !== "GET") {
      refuse("schema.method", `${path}.method`,
        "method $method is not supported; this release sends GET only, " +
        "spelled exactly \"GET\"", { method });
    }

    const url = str(r, "url", path);
    if (url === "") refuse("schema.type", `${path}.url`, "url is empty");

    let headers = [];
    if ("headers" in r) {
      if (!Array.isArray(r.headers)) {
        refuse("schema.type", `${path}.headers`,
          "expected an array of { name, value }; an object cannot express " +
          "duplicate field names");
      }
      headers = r.headers.map((h, k) => {
        const hp = `${path}.headers[${k}]`;
        if (!isPlainObject(h)) refuse("schema.type", hp, "expected an object");
        only(h, ["name", "value"], hp);
        const name = str(h, "name", hp);
        // Header NAMES are literal — substitution applies to values only. A
        // template in a name is refused for free: { and } are not token
        // characters.
        if (!TOKEN.test(name)) {
          refuse("schema.header.name", `${hp}.name`,
            "$name is not a valid header name", { name });
        }
        return { name, value: str(h, "value", hp) };
      });
    }

    return { id, name: r.name ?? null, method, url, headers, path };
  });

  return { schemaVersion: SCHEMA_VERSION, variables, requests };
}

// A file with several requests and no --request is REFUSED, listing the ids.
// `run` sends THE request you were shown, singular; and a partial failure has
// no coherent exit code under the taxonomy. `resolve` follows the same rule so
// that the two commands select identically.
export function selectRequest(workspace, requestId) {
  const ids = workspace.requests.map((r) => r.id);

  if (ids.length === 0) {
    refuse("selection.none", "requests", "this file contains no requests");
  }

  if (requestId === undefined || requestId === null) {
    if (ids.length === 1) return workspace.requests[0];
    refuse("selection.ambiguous", "requests",
      "this file contains $count requests; name one with --request. " +
      "Available ids: $ids",
      { count: ids.length, ids: ids.join(", ") });
  }

  const found = workspace.requests.find((r) => r.id === requestId);
  if (!found) {
    refuse("selection.unknown", "requests",
      "no request with id $requested. Available ids: $ids",
      { requested: requestId, ids: ids.join(", ") });
  }
  return found;
}

export { SCHEMA_VERSION };
