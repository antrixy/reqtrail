// selftest.mjs — HeaderWright selftest suite.
// Run: node test/selftest.mjs   (from the repo root; no dependencies)
// Exit code 0 iff every check passes AND the total equals EXPECTED_CHECKS.
//
// Scope: everything in extension/lib/ — the pure layer with no chrome.*
// calls, which is why lib/ exists as a separate directory. This suite
// verifies rule CONSTRUCTION and format STABILITY. It deliberately makes
// no claim about rule APPLICATION to real traffic: a rule can be built
// correctly, match in the oracle, and still no-op without a host
// permission grant. Application evidence comes from the manual smoke test
// in test/SMOKE.md, run against a live echo endpoint — not from here.
//
// Count tripwire: EXPECTED_CHECKS below is the promotion tripwire, same
// mechanism as toon-diff's selftest counts. Adding checks requires
// bumping it in the same commit; a change that silently drops checks
// fails the run. Update it deliberately or not at all.

import {
  validateHeaderEntry,
  isValidDomain,
  profileToRule,
  RESOURCE_TYPES,
  APPENDABLE_REQUEST_HEADERS,
  isValidHeaderName,
  isValidHeaderValue,
  isValidRuleId,
  nextRuleId,
  normalizeDomains,
  MAX_UNSAFE_DYNAMIC_RULES,
  MAX_RULE_ID,
} from "../extension/lib/rules.js";
import {
  canonicalizeProfiles,
  stableStringify,
  serializeProfiles,
  parseProfilesFile,
  FILE_FORMAT,
  FILE_VERSION,
} from "../extension/lib/canonical.js";
import {
  diffDomainGrants,
  referencedDomains,
  originsForDomain,
  originsFor,
  isIpLiteral,
  isManagedOrigin,
  staleManagedOrigins,
  legacyOriginsForDomain,
  isLegacyOnlyGrant,
} from "../extension/lib/grants.js";
import {
  computeBadge,
  describeSync,
  BADGE_ON,
  BADGE_OFF,
  BADGE_FAILED,
  DEFAULT_SYNC_STATE,
} from "../extension/lib/status.js";
import {
  domainsOverlap,
  domainListsOverlap,
  headerNamesFor,
  headerKeysFor,
  sideOf,
  findCollisions,
  collidingProfileIds,
  describeCollisions,
  describeSaveRefusal,
  describeImportRefusal,
} from "../extension/lib/collisions.js";
import { createSerialQueue, createDebounced } from "../extension/lib/queue.js";
import { readFileSync } from "node:fs";

const EXPECTED_CHECKS = 309;

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

// Returns fn()'s value, or the THREW sentinel if it raised.
//
// EVERY success-expecting call into lib/ must go through this. An uncaught
// throw aborts the whole run: no FAIL lines are printed, the count tripwire
// never executes, and the result is indistinguishable from "no check covers
// this". That produced a false "0 fails" mutation reading TWICE while building
// v0.1.2 — once on the generated-id round trip, once on the cap boundary — and
// a mutation that appears uncaught is exactly the reading that stops someone
// writing the check that was already there.
const THREW = Symbol("threw");
function attempt(fn) {
  try {
    return fn();
  } catch {
    return THREW;
  }
}

function checkThrows(name, fn, messageIncludes) {
  try {
    fn();
    failed++;
    console.error(`FAIL: ${name} (did not throw)`);
  } catch (err) {
    if (messageIncludes && !err.message.includes(messageIncludes)) {
      failed++;
      console.error(
        `FAIL: ${name} (threw "${err.message}", expected it to include "${messageIncludes}")`
      );
    } else {
      passed++;
    }
  }
}

// ------------------------------------------------- validateHeaderEntry

check("set with value is valid",
  validateHeaderEntry({ name: "X-A", operation: "set", value: "1" }).valid);
check("remove without value is valid",
  validateHeaderEntry({ name: "X-A", operation: "remove" }).valid);
check("append on allowlisted header is valid",
  validateHeaderEntry({ name: "cookie", operation: "append", value: "k=v" }).valid);
check("append allowlist is case-insensitive on input",
  validateHeaderEntry({ name: "Cookie", operation: "append", value: "k=v" }).valid);
check("append on non-allowlisted header is invalid",
  !validateHeaderEntry({ name: "X-Custom", operation: "append", value: "1" }).valid);
check("set without value is invalid",
  !validateHeaderEntry({ name: "X-A", operation: "set" }).valid);
check("set with empty value is invalid",
  !validateHeaderEntry({ name: "X-A", operation: "set", value: "" }).valid);
check("empty header name is invalid",
  !validateHeaderEntry({ name: "", operation: "set", value: "1" }).valid);
check("whitespace header name is invalid",
  !validateHeaderEntry({ name: "  ", operation: "set", value: "1" }).valid);
check("unknown operation is invalid",
  !validateHeaderEntry({ name: "X-A", operation: "add", value: "1" }).valid);
check("null entry is invalid",
  !validateHeaderEntry(null).valid);

// ------------------------------------------------------- isValidDomain

check("example.com is valid", isValidDomain("example.com"));
check("sub.example.com is valid", isValidDomain("sub.example.com"));
check("localhost is valid (single label, deliberate)", isValidDomain("localhost"));
check("hyphenated label is valid", isValidDomain("my-api.example.co"));
check("scheme is invalid", !isValidDomain("https://example.com"));
check("port is invalid", !isValidDomain("localhost:3000"));
check("path is invalid", !isValidDomain("example.com/x"));
check("leading hyphen is invalid", !isValidDomain("-example.com"));
check("trailing dot is invalid", !isValidDomain("example.com."));
check("empty string is invalid", !isValidDomain(""));
check("uppercase is invalid (callers lowercase first)", !isValidDomain("Example.com"));

// ------------------------------------------------------- profileToRule

const baseProfile = {
  id: 3,
  name: "P",
  domains: ["a.example.com", "b.example.com"],
  headers: [
    { name: "X-A", operation: "set", value: "1" },
    { name: "X-Bad", operation: "append", value: "x" }, // invalid: filtered
    { name: "X-B", operation: "remove" },
  ],
};

const rule = profileToRule(baseProfile, ["a.example.com"]);
check("rule id equals profile id", rule.id === 3);
check("rule condition uses only granted domains",
  rule.condition.requestDomains.length === 1 &&
  rule.condition.requestDomains[0] === "a.example.com");
// `?.` ON BOTH, AND THE REASON IS NOT STYLE. These two checks predate v0.2.0,
// when profileToRule() always emitted requestHeaders and an unguarded access
// could not throw. The side split made the array OMITTABLE — it is assigned
// only when non-empty — so any mutation that routes these entries to the
// response side leaves requestHeaders undefined and these lines throw.
// mutate-collisions.py counts `^FAIL:` lines, so a throw aborts the suite and
// scores whatever happened to run first: the "legacy default flips" mutant
// died here at 2 fails with 307 checks never executed, and its real coverage
// was unmeasured. A check that throws is worse than one that fails, because
// it misreports. Reach for `?.` by default when indexing into any structure
// the builder may legitimately omit.
check("invalid header entries are filtered out",
  rule.action.requestHeaders?.length === 2);
// The guard must make a MISSING array fail, not pass. `"value" in ({})` is
// false, so defaulting the lookup to an empty object would have reported a
// pass on an absent array — the vacuous-success shape this whole edit exists
// to remove. The length conjunct short-circuits instead: undefined fails the
// check and the index never evaluates.
check("remove entry carries no value key",
  rule.action.requestHeaders?.length === 2 &&
  !("value" in rule.action.requestHeaders[1]));
check("resourceTypes is the full explicit list (main_frame default bug)",
  rule.condition.resourceTypes.length === RESOURCE_TYPES.length &&
  rule.condition.resourceTypes.includes("main_frame"));
check("no granted domains yields null", profileToRule(baseProfile, []) === null);
check("null grantedDomains yields null", profileToRule(baseProfile, null) === null);
check("no valid headers yields null",
  profileToRule(
    { id: 1, name: "P", domains: ["a.com"], headers: [{ name: "X", operation: "append", value: "1" }] },
    ["a.com"]
  ) === null);
check("append allowlist is non-trivially sized",
  APPENDABLE_REQUEST_HEADERS.size >= 15);

// ---------------------------------------------------------- canonical

const messyProfiles = [
  { id: 2, name: "B", domains: ["z.example.com", "a.example.com"], headers: [
    { name: "X-Two", operation: "remove" },
    { name: "X-One", operation: "set", value: "v1" },
  ]},
  { id: 1, name: "A", domains: ["LOCALHOST"], headers: [
    { name: "cookie", operation: "append", value: "k=v" },
  ]},
];

const s1 = serializeProfiles(messyProfiles);
check("serializing twice is byte-identical", s1 === serializeProfiles(messyProfiles));
check("profile input order does not affect bytes",
  s1 === serializeProfiles([messyProfiles[1], messyProfiles[0]]));
check("round-trip (parse then serialize) is byte-identical",
  s1 === attempt(() => serializeProfiles(parseProfilesFile(s1))));
check("output ends with exactly one trailing newline",
  s1.endsWith("}\n") && !s1.endsWith("\n\n"));
check("domains are sorted and lowercased in canonical form",
  canonicalizeProfiles(messyProfiles)[0].domains[0] === "localhost" &&
  canonicalizeProfiles(messyProfiles)[1].domains.join(",") === "a.example.com,z.example.com");
check("header order is preserved (not sorted)",
  canonicalizeProfiles(messyProfiles)[1].headers[0].name === "X-Two");
check("stableStringify sorts object keys",
  stableStringify({ b: 1, a: 2 }) === '{\n  "a": 2,\n  "b": 1\n}');
check("stableStringify handles empty object and array",
  stableStringify({}) === "{}" && stableStringify([]) === "[]");

const validDoc = (profiles) =>
  JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, profiles });

checkThrows("rejects non-JSON", () => parseProfilesFile("{{{"), "not valid JSON");
checkThrows("rejects wrong format", () =>
  parseProfilesFile(JSON.stringify({ format: "x", version: 1, profiles: [] })), '"format"');
checkThrows("rejects wrong version", () =>
  parseProfilesFile(JSON.stringify({ format: FILE_FORMAT, version: 2, profiles: [] })), "version");
checkThrows("rejects duplicate ids", () =>
  parseProfilesFile(validDoc([
    { id: 1, name: "a", domains: ["a.com"], headers: [{ name: "x", operation: "set", value: "1" }] },
    { id: 1, name: "b", domains: ["b.com"], headers: [{ name: "x", operation: "set", value: "1" }] },
  ])), "duplicate id");
checkThrows("rejects invalid domain", () =>
  parseProfilesFile(validDoc([
    { id: 1, name: "a", domains: ["not a domain!"], headers: [{ name: "x", operation: "set", value: "1" }] },
  ])), "not a valid domain");
checkThrows("rejects append-allowlist violation via import", () =>
  parseProfilesFile(validDoc([
    { id: 1, name: "a", domains: ["a.com"], headers: [{ name: "X-Custom", operation: "append", value: "1" }] },
  ])), "does not support append");
checkThrows("rejects empty headers array", () =>
  parseProfilesFile(validDoc([
    { id: 1, name: "a", domains: ["a.com"], headers: [] },
  ])), '"headers"');
check("accepts and canonicalizes a valid file",
  attempt(() => parseProfilesFile(validDoc([
    { id: 1, name: "a", domains: ["B.com", "a.com"], headers: [{ name: "x", operation: "set", value: "1" }] },
  ]))[0].domains.join(",")) === "a.com,b.com");

// ------------------------------------------------- grants / A1 scenarios
// Shared-domain retention FIRST: it is the case a naive "revoke whatever
// the edited profile used to have" fix silently breaks, and the case that
// would have caught finding 1b.

const prof = (id, domains) => ({
  id,
  name: `P${id}`,
  domains,
  headers: [{ name: "X-A", operation: "set", value: "1" }],
});

// Setup: A: example.com   B: example.com, api.example.com
const setA1 = [prof(1, ["example.com"]), prof(2, ["example.com", "api.example.com"])];
// Edit A: example.com -> localhost
const setA2 = [prof(1, ["localhost"]), prof(2, ["example.com", "api.example.com"])];
// Then edit B: example.com, api.example.com -> localhost
const setA3 = [prof(1, ["localhost"]), prof(2, ["localhost"])];

const editA = diffDomainGrants({
  previousProfiles: setA1,
  nextProfiles: setA2,
  grantedDomains: ["example.com", "api.example.com"],
});
check("A1: shared domain RETAINED when one profile stops referencing it",
  !editA.toRevoke.includes("example.com"));
check("A1: untouched domain of another profile RETAINED",
  !editA.toRevoke.includes("api.example.com"));
check("A1: newly referenced domain is requested",
  editA.toRequest.join(",") === "localhost");
check("A1: edit revokes nothing while a reference survives",
  editA.toRevoke.length === 0);

const editB = diffDomainGrants({
  previousProfiles: setA2,
  nextProfiles: setA3,
  grantedDomains: ["example.com", "api.example.com", "localhost"],
});
check("A1: now-unreferenced domains are REVOKED",
  editB.toRevoke.join(",") === "api.example.com,example.com");
check("A1: still-referenced domain is not revoked",
  !editB.toRevoke.includes("localhost"));
check("A1: already-granted domain is not re-requested",
  editB.toRequest.length === 0);

check("A1: unchanged profile set produces no permission churn",
  (() => {
    const d = diffDomainGrants({
      previousProfiles: setA1,
      nextProfiles: setA1,
      grantedDomains: ["example.com", "api.example.com"],
    });
    return d.toRequest.length === 0 && d.toRevoke.length === 0;
  })());
// REVERSED IN v0.1.7, AND THE OLD ASSERTION IS QUOTED SO THIS READS AS A
// RULING RATHER THAN A DELETION. It used to read "unchanged set STILL
// re-requests a denied domain (finding 2 recovery path)" and asserted
// toRequest === "api.example.com". Two things were wrong with it. The
// behaviour is FINDING-028: an unchanged set has nothing new to want, and
// requesting anyway is what let one approval on a delete confirmation grant
// four unapproved domains. And the NAME was wrong — finding 2's recovery path
// is the clickable chip, which finding 2 shipped precisely because Edit->Save
// "works and nothing in the interface suggested" it. The check was named after
// the fix while pinning the workaround the fix replaced.
check("A1: unchanged set does NOT re-request a denied domain (v0.1.7, FINDING-028)",
  diffDomainGrants({
    previousProfiles: setA1,
    nextProfiles: setA1,
    grantedDomains: ["example.com"],
  }).toRequest.length === 0);

// ---------------------------------------------------- FINDING-028 / 024
//
// The defect in one sentence: toRequest was diffed against grant state alone,
// so it was every ungranted domain in the SURVIVING set regardless of what the
// change did. These rows are the shapes that were wrong, not paraphrases of
// the fix — each one returns something non-empty against v0.1.6.

check("F028: a delete requests NOTHING, even with ungranted survivors",
  diffDomainGrants({
    previousProfiles: setA1,
    nextProfiles: [setA1[0]],
    grantedDomains: [],
  }).toRequest.length === 0);

// OBS-E5's exact shape: five profiles, every grant denied, delete the first.
// v0.1.6 returned the other four here and one approval took all of them.
check("F028: OBS-E5 shape — delete with ALL grants denied requests nothing",
  (() => {
    const five = [1, 2, 3, 4, 5].map((i) => prof(i, [`p${i}.test`]));
    return diffDomainGrants({
      previousProfiles: five,
      nextProfiles: five.slice(1),
      grantedDomains: [],
    }).toRequest.length === 0;
  })());

// The narrowing must not cost a legitimate request. An ADDED domain is still
// requested while ungranted survivors are left alone — both halves in one row,
// because asserting only the first would pass on a function that requests
// everything.
check("F028: an ADDED domain is requested while ungranted survivors are not",
  (() => {
    const before = [prof(1, ["old.test"])];
    const after = [prof(1, ["old.test"]), prof(2, ["new.test"])];
    return diffDomainGrants({
      previousProfiles: before,
      nextProfiles: after,
      grantedDomains: [],
    }).toRequest.join(",") === "new.test";
  })());

// FOUND BY THE MUTATION PASS, NOT BY REVIEW. Dropping the grant intersection
// and keeping only the membership diff survived every row above with zero
// failures: it produces the right answer for every ungranted case and requests
// a domain that is already fully granted. That is permission churn on an
// ordinary save, and it is the half of asymmetry 2 that v0.1.7 KEPT.
check("A1: adding an ALREADY-GRANTED domain requests nothing",
  diffDomainGrants({
    previousProfiles: [prof(1, ["a.test"])],
    nextProfiles: [prof(1, ["a.test"]), prof(2, ["b.test"])],
    grantedDomains: ["a.test", "b.test"],
  }).toRequest.length === 0);

// FINDING-024 is the same line seen through the legacy set: editing one
// profile re-requested every legacy domain in the config at once, which
// contradicted the migration notice's own "click any underlined domain".
check("F024: a save does not re-request ANOTHER profile's legacy domain",
  diffDomainGrants({
    previousProfiles: [prof(1, ["legacy.test"]), prof(2, ["a.test"])],
    nextProfiles: [prof(1, ["legacy.test"]), prof(2, ["b.test"])],
    grantedDomains: ["a.test"],
    heldDomains: ["a.test", "legacy.test"],
  }).toRequest.join(",") === "b.test");
check("A1: delete revokes only what no remaining profile references",
  diffDomainGrants({
    previousProfiles: setA1,
    nextProfiles: [setA1[0]],
    grantedDomains: ["example.com", "api.example.com"],
  }).toRevoke.join(",") === "api.example.com");
check("A1: never revokes a domain that was not granted",
  diffDomainGrants({
    previousProfiles: setA1,
    nextProfiles: [],
    grantedDomains: ["example.com"],
  }).toRevoke.join(",") === "example.com");
check("A1: import replace-all drops old and requests new",
  (() => {
    const d = diffDomainGrants({
      previousProfiles: setA1,
      nextProfiles: [prof(9, ["other.test"])],
      grantedDomains: ["example.com", "api.example.com"],
    });
    return d.toRevoke.join(",") === "api.example.com,example.com" &&
      d.toRequest.join(",") === "other.test";
  })());
check("A1: results are sorted and deduplicated",
  diffDomainGrants({
    previousProfiles: [],
    nextProfiles: [prof(1, ["z.test", "a.test"]), prof(2, ["a.test"])],
    grantedDomains: [],
  }).toRequest.join(",") === "a.test,z.test");

check("referencedDomains dedupes across profiles",
  referencedDomains(setA1).join(",") === "api.example.com,example.com");
check("referencedDomains tolerates a profile with no domains key",
  referencedDomains([{ id: 1, name: "x" }]).length === 0);
// ------------------------------------------------ origin patterns (F18/F19)
//
// THE PINNED BUG. Through v0.1.3 this section asserted
//   originFor("localhost") === "*://localhost/*"
// which is a faithful test of the wrong thing: it pinned an exact-host
// permission against a DNR condition that also matches subdomains, so the
// suite went green on precisely the mismatch that made every subdomain rule
// a silent no-op. A string-equality test cannot catch that class of bug. The
// oracle below compares COVERED HOST SETS, which can.

// Does DNR's requestDomains entry `domain` match `host`? Chrome: the domain
// itself and any subdomain of it.
function dnrCovers(domain, host) {
  return host === domain || host.endsWith("." + domain);
}

// Does a Chrome match pattern of the shape "*://HOST/*" cover `host`?
// "*.d" covers d and any subdomain of d; a bare host covers itself only.
function patternCovers(pattern, host) {
  const m = /^\*:\/\/(.+)\/\*$/.exec(pattern);
  if (!m) return false;
  const pat = m[1];
  if (pat.startsWith("*.")) {
    const base = pat.slice(2);
    return host === base || host.endsWith("." + base);
  }
  return host === pat;
}

const HOST_CORPUS = [
  "example.com",
  "api.example.com",
  "foo.api.example.com",
  "notexample.com",
  "example.com.evil.test",
  "evil-example.com",
  "localhost",
  "sub.localhost",
  "192.168.1.5",
  "sub.192.168.1.5",
];

check("F18 INVARIANT: permission set covers exactly the DNR host set",
  ["example.com", "localhost", "a.b.test"].every((domain) =>
    HOST_CORPUS.every(
      (host) =>
        dnrCovers(domain, host) ===
        originsForDomain(domain).some((p) => patternCovers(p, host))
    )
  ));
check("F18: the apex domain is covered",
  originsForDomain("example.com").some((p) =>
    patternCovers(p, "example.com")));
check("F18: a subdomain is covered — the v0.1.3 regression",
  originsForDomain("example.com").some((p) =>
    patternCovers(p, "api.example.com")));
check("F18: a deep subdomain is covered",
  originsForDomain("example.com").some((p) =>
    patternCovers(p, "a.b.c.example.com")));
check("F18: a suffix-confusable host is NOT covered",
  !originsForDomain("example.com").some((p) =>
    patternCovers(p, "notexample.com")));
check("F18: the domain as a left label of another host is NOT covered",
  !originsForDomain("example.com").some((p) =>
    patternCovers(p, "example.com.evil.test")));
check("F18: both patterns are emitted for a hostname",
  originsForDomain("example.com").join(" ") ===
    "*://example.com/* *://*.example.com/*");
check("F18: the v0.1.3 pattern is still in the set, so upgrades orphan nothing",
  originsForDomain("example.com").includes("*://example.com/*"));
check("F18: an IPv4 literal gets the apex pattern only",
  originsForDomain("192.168.1.5").join(" ") === "*://192.168.1.5/*");
check("F18: isIpLiteral accepts a dotted quad and rejects a hostname",
  isIpLiteral("10.0.0.1") && !isIpLiteral("example.com") &&
    !isIpLiteral("1.2.3") && !isIpLiteral(""));
check("F18: originsFor flattens, dedupes, and sorts",
  originsFor(["b.test", "a.test", "b.test"]).join(" ") ===
    "*://*.a.test/* *://*.b.test/* *://a.test/* *://b.test/*");
check("F18: originsFor tolerates a missing list",
  originsFor(undefined).length === 0);

check("F19: isManagedOrigin recognizes both shapes this extension emits",
  isManagedOrigin("*://example.com/*") &&
    isManagedOrigin("*://*.example.com/*"));
check("F19: isManagedOrigin rejects all-hosts and foreign shapes",
  !isManagedOrigin("*://*/*") && !isManagedOrigin("<all_urls>") &&
    !isManagedOrigin("https://example.com/*") &&
    !isManagedOrigin("*://example.com/path*"));
check("F19: a grant no profile references is stale",
  staleManagedOrigins(setA1, [
    "*://example.com/*",
    "*://*.example.com/*",
    "*://api.example.com/*",
    "*://*.api.example.com/*",
    "*://old.example.com/*",
  ]).join(" ") === "*://old.example.com/*");
check("F19: a referenced domain's grants are never stale",
  staleManagedOrigins([prof(1, ["a.test"])], [
    "*://a.test/*",
    "*://*.a.test/*",
  ]).length === 0);
check("F19: a partial v0.1.3-era grant is retained, not swept",
  staleManagedOrigins([prof(1, ["a.test"])],
    ["*://a.test/*"]).length === 0);
check("F19: user-granted all-hosts is left alone",
  staleManagedOrigins([], ["*://*/*", "<all_urls>"]).length === 0);
check("F19: a scheme-specific grant is outside the sweep",
  staleManagedOrigins([], ["https://a.test/*", "http://a.test/*"]).length === 0);
// PINS A KNOWN LIMITATION, not a desired behaviour. The sweep cannot tell a
// grant it requested from one the user made, because getAll() carries no
// provenance. This check records that an unreferenced managed-SHAPE origin
// is removed regardless of origin-of-origin; if a provenance ledger ever
// lands, this is the check that must change and the reason it existed.
check("F19: an unreferenced managed-shape grant is swept (provenance unknown)",
  staleManagedOrigins([], ["*://a.test/*", "*://*.a.test/*"]).length === 2);
check("F19: tolerates a missing origins list",
  staleManagedOrigins(setA1, undefined).length === 0);

// ------------------------------------- legacy-only revocation (finding 20)
// REGRESSION SUITE for a bug THIS RELEASE INTRODUCED and caught before
// shipping. v0.1.3 revoked correctly on
// delete; the strict grant check added for finding 18 was then fed to the
// revoke path too, and a mid-migration domain fell through both branches —
// not granted enough to use, not granted enough to release. These pin the
// two sets apart so collapsing them again fails here rather than in the
// field. The legacy install is the ONLY state where they differ, which is
// exactly why the original suite could not see it.

const legacyProf = [prof(1, ["example.com"])];

check("F20: delete releases a legacy-only grant (strict-only leaked it)",
  diffDomainGrants({
    previousProfiles: legacyProf,
    nextProfiles: [],
    grantedDomains: [],
    heldDomains: ["example.com"],
  }).toRevoke.join(",") === "example.com");
check("F20: editing a domain out releases its legacy-only grant",
  diffDomainGrants({
    previousProfiles: legacyProf,
    nextProfiles: [prof(1, ["other.test"])],
    grantedDomains: [],
    heldDomains: ["example.com"],
  }).toRevoke.join(",") === "example.com");
check("F20: import replace-all releases legacy-only grants it drops",
  diffDomainGrants({
    previousProfiles: legacyProf,
    nextProfiles: [prof(9, ["other.test"])],
    grantedDomains: [],
    heldDomains: ["example.com"],
  }).toRevoke.join(",") === "example.com");
check("F20: a legacy-only domain still in use is RETAINED",
  diffDomainGrants({
    previousProfiles: legacyProf,
    nextProfiles: legacyProf,
    grantedDomains: [],
    heldDomains: ["example.com"],
  }).toRevoke.length === 0);
check("F20: a legacy-only domain another profile references is RETAINED",
  diffDomainGrants({
    previousProfiles: [prof(1, ["example.com"]), prof(2, ["example.com"])],
    nextProfiles: [prof(2, ["example.com"])],
    grantedDomains: [],
    heldDomains: ["example.com"],
  }).toRevoke.length === 0);
// REVERSED IN v0.1.7 with the old assertion kept. It read "MIGRATION PATH
// SURVIVES — a legacy domain is still re-requested" and asserted
// toRequest === "example.com" for an UNCHANGED profile set. That is
// FINDING-024's mechanism stated as a requirement. What finding 20 was
// actually protecting is the STRICT/PERMISSIVE split, and that split is
// unaffected: the row below still holds it, and the row under it proves a
// legacy domain the change ADDS is still requested in full.
check("F20/F028: a legacy-only domain in BOTH sets is NOT re-requested",
  diffDomainGrants({
    previousProfiles: legacyProf,
    nextProfiles: legacyProf,
    grantedDomains: [],
    heldDomains: ["example.com"],
  }).toRequest.length === 0);

// The strict set is still strict where it matters. A domain this change adds,
// holding only the pre-0.1.4 apex pattern, reads as ungranted and is requested
// so the upgrade completes. Swapping toRequest to the permissive set would
// pass every row above and fail this one.
check("F20: a legacy-only domain ADDED by this change IS requested",
  diffDomainGrants({
    previousProfiles: [],
    nextProfiles: legacyProf,
    grantedDomains: [],
    heldDomains: ["example.com"],
  }).toRequest.join(",") === "example.com");
check("F20: the two sets are read from opposite sides, not interchangeable",
  (() => {
    const d = diffDomainGrants({
      previousProfiles: [prof(1, ["gone.test"]), prof(2, ["kept.test"])],
      nextProfiles: [prof(2, ["kept.test"])],
      grantedDomains: ["kept.test"],
      heldDomains: ["gone.test", "kept.test"],
    });
    // gone.test is held but never fully granted: revoke it, never request it.
    return d.toRevoke.join(",") === "gone.test" && d.toRequest.length === 0;
  })());
check("F20: heldDomains defaults to grantedDomains for untaught callers",
  diffDomainGrants({
    previousProfiles: legacyProf,
    nextProfiles: [],
    grantedDomains: ["example.com"],
  }).toRevoke.join(",") === "example.com");
check("F20: nothing held means nothing to revoke",
  diffDomainGrants({
    previousProfiles: legacyProf,
    nextProfiles: [],
    grantedDomains: [],
    heldDomains: [],
  }).toRevoke.length === 0);

// ------------------------------------------- upgrade notice (F18 migration)// The notice is driven ENTIRELY by this predicate, which is why it is pure
// and lives here rather than as a version check in popup.js. The property
// that matters is not "does it show" but "can it stop showing": every path
// to true requires a legacy grant, and granting clears it permanently.

check("F18 migration: a v0.1.3-era grant needs re-approval",
  isLegacyOnlyGrant("example.com",
    { legacyGranted: true, currentGranted: false }));
check("F18 migration: SELF-EXPIRES — re-granting clears it forever",
  !isLegacyOnlyGrant("example.com",
    { legacyGranted: true, currentGranted: true }));
check("F18 migration: a never-granted domain is not a migration",
  !isLegacyOnlyGrant("example.com",
    { legacyGranted: false, currentGranted: false }));
check("F18 migration: unreachable on a fresh install (no legacy grant)",
  ["example.com", "a.b.test", "localhost"].every((d) =>
    !isLegacyOnlyGrant(d, { legacyGranted: false, currentGranted: false })));
check("F18 migration: an IP literal never migrates — the shapes are equal",
  !isLegacyOnlyGrant("192.168.1.5",
    { legacyGranted: true, currentGranted: false }));
check("F18 migration: legacyOriginsForDomain is the exact v0.1.3 output",
  legacyOriginsForDomain("example.com").join(" ") === "*://example.com/*");
check("F18 migration: the legacy pattern is a subset of the current set",
  legacyOriginsForDomain("example.com").every((o) =>
    originsForDomain("example.com").includes(o)));

// ------------------------------------------- header syntax (finding 3, A2)
// Provenance: RFC 9110 token set for names; NUL/CR/LF plus the remaining C0
// controls and DEL for values. The Chrome DNR reference specifies NEITHER —
// see the PROVENANCE comments in lib/rules.js.

check("plain token name is valid", isValidHeaderName("X-Custom-Header"));
check("RFC token specials are valid", isValidHeaderName("a!#$%&'*+-.^_`|~9Z"));
check("name with a space is invalid", !isValidHeaderName("X Custom"));
check("name with a colon is invalid", !isValidHeaderName("X-Custom:"));
check("name with leading whitespace is invalid (import path has no trim)",
  !isValidHeaderName(" X-Custom"));
check("name with trailing whitespace is invalid", !isValidHeaderName("X-Custom "));
check("empty name is invalid", !isValidHeaderName(""));
check("name with a tab is invalid", !isValidHeaderName("X\tCustom"));
check("non-string name is invalid", !isValidHeaderName(null));

check("ordinary value is valid", isValidHeaderValue("Hello, world/1.0 (test)"));
check("value with NUL is invalid", !isValidHeaderValue("a\u0000b"));
check("value with CR is invalid", !isValidHeaderValue("a\rb"));
check("value with LF is invalid", !isValidHeaderValue("a\nb"));
check("value with CRLF injection is invalid",
  !isValidHeaderValue("x\r\nX-Injected: 1"));
check("value with DEL is invalid", !isValidHeaderValue("a\u007fb"));
check("value with another C0 control is invalid (deliberate, stricter)",
  !isValidHeaderValue("a\u0001b"));
check("value with HTAB is invalid (KNOWN deviation: RFC allows it)",
  !isValidHeaderValue("a\tb"));
check("non-string value is invalid", !isValidHeaderValue(undefined));

check("bad name rejected through validateHeaderEntry",
  !validateHeaderEntry({ name: "X Custom", operation: "set", value: "1" }).valid);
check("bad value rejected through validateHeaderEntry",
  !validateHeaderEntry({ name: "X-A", operation: "set", value: "a\r\nb" }).valid);
check("remove operation ignores the value channel entirely",
  validateHeaderEntry({ name: "X-A", operation: "remove", value: "a\rb" }).valid);

// ------------------------------------------ rule-id range (finding 3, A3)

check("id 1 is valid", isValidRuleId(1));
check("id at the inferred maximum is valid", isValidRuleId(MAX_RULE_ID));
check("id 0 is invalid", !isValidRuleId(0));
check("negative id is invalid", !isValidRuleId(-1));
check("non-integer id is invalid", !isValidRuleId(1.5));
check("id above the inferred maximum is invalid", !isValidRuleId(MAX_RULE_ID + 1));
check("MAX_SAFE_INTEGER id is invalid", !isValidRuleId(Number.MAX_SAFE_INTEGER));
check("NaN id is invalid", !isValidRuleId(NaN));
checkThrows("import rejects an over-range id", () =>
  parseProfilesFile(validDoc([
    { id: MAX_RULE_ID + 1, name: "a", domains: ["a.com"],
      headers: [{ name: "x", operation: "set", value: "1" }] },
  ])), '"id" must be an integer');

// -------------------------------- generated rule ids (finding 9, A3 extended)
// A3 was written for the IMPORT path and satisfied there. The GENERATION path
// in saveProfile() was never covered, and finding 9 is what came through the
// gap. These checks pin the generator against the same bound import obeys.

const idSet = (...ids) => ids.map((id) => ({ id, name: "p", domains: ["a.com"],
  headers: [{ name: "x", operation: "set", value: "1" }] }));

check("first profile gets id 1", nextRuleId([]) === 1);
check("null profile set is treated as empty", nextRuleId(null) === 1);
check("contiguous ids allocate above the top", nextRuleId(idSet(1, 2, 3)) === 4);
check("a gap is filled before extending", nextRuleId(idSet(1, 3)) === 2);
check("the lowest gap wins, not the first found scanning ids",
  nextRuleId(idSet(2, 3, 5)) === 1);
check("unsorted input allocates the same as sorted",
  nextRuleId(idSet(3, 1, 2)) === nextRuleId(idSet(1, 2, 3)));
check("non-integer ids in storage do not block allocation",
  nextRuleId([{ id: "1" }, { id: null }, { id: 1.5 }]) === 1);

// THE FINDING 9 CASE ITSELF. max(id)+1 over a ceiling profile is 2147483648,
// which Chrome rejects as a 32-bit overflow and which the old generator wrote
// to storage unchecked. Both halves are pinned: the result must be in range,
// and it must specifically not be the overflowing value.
check("a ceiling profile does not poison the id space",
  nextRuleId(idSet(MAX_RULE_ID)) === 1);
check("generated id after a ceiling profile is valid",
  isValidRuleId(nextRuleId(idSet(MAX_RULE_ID))));
check("generated id after a ceiling profile is NOT max+1",
  nextRuleId(idSet(MAX_RULE_ID)) !== MAX_RULE_ID + 1);
check("ceiling plus a contiguous block still fills the gap",
  nextRuleId(idSet(1, 2, 3, MAX_RULE_ID)) === 4);

// The generator's output must satisfy the same predicate import enforces, and
// must never collide with a live id. Checked across a spread of shapes rather
// than one, so a fix that special-cases the ceiling alone does not pass.
let allValid = true;
let noCollision = true;
for (const ids of [[], [1], [1, 2, 3], [2, 3], [5, 9], [MAX_RULE_ID],
                   [1, MAX_RULE_ID], [MAX_RULE_ID - 1, MAX_RULE_ID]]) {
  const generated = nextRuleId(idSet(...ids));
  if (!isValidRuleId(generated)) allValid = false;
  if (ids.includes(generated)) noCollision = false;
}
check("every generated id is a valid rule id", allValid);
check("no generated id collides with an existing profile", noCollision);

// A generated id must survive the import path, which is the boundary the
// generator was failing to inherit from. Round-trips the invented id through
// parseProfilesFile rather than asserting about it in isolation.
// Caught rather than allowed to propagate on purpose: a generator regression
// makes parseProfilesFile THROW here, and an uncaught throw aborts the run
// mid-suite, which makes the mutation failure COUNT unreadable and skips the
// count tripwire entirely. This must register as a failed check, not a crash.
const generatedAfterCeiling = nextRuleId(idSet(MAX_RULE_ID));
check("a generated id round-trips through import validation",
  attempt(() => parseProfilesFile(validDoc(idSet(generatedAfterCeiling)))[0].id)
    === generatedAfterCeiling);

// ------------------------------------------- domain dedup (finding 7)
// The contract claimed set semantics for domains and the serializer did not
// honour them. These pin the conformance fix, NOT a format change: version
// stays 1 and no conforming file's bytes move.

check("normalizeDomains removes exact duplicates",
  normalizeDomains(["a.com", "a.com", "a.com"]).join(",") === "a.com");
check("normalizeDomains dedups case-insensitively",
  normalizeDomains(["example.com", "EXAMPLE.com", "Example.COM"]).join(",")
    === "example.com");
check("normalizeDomains sorts",
  normalizeDomains(["z.com", "a.com"]).join(",") === "a.com,z.com");
check("normalizeDomains tolerates a missing list",
  normalizeDomains(undefined).length === 0 && normalizeDomains(null).length === 0);
check("normalizeDomains drops non-strings rather than throwing",
  normalizeDomains(["a.com", 7, null, "a.com"]).join(",") === "a.com");
check("normalizeDomains is idempotent",
  normalizeDomains(normalizeDomains(["B.com", "b.com", "a.com"])).join(",")
    === normalizeDomains(["B.com", "b.com", "a.com"]).join(","));

// THE TEST C COUNTEREXAMPLE, kept as the regression fixture. This exact
// profile exported as ["example.com","example.com","example.com"] on v0.1.1
// while the status line read "1/1 domain granted".
const dupProfile = [{
  id: 1, name: "Test",
  domains: ["example.com", "EXAMPLE.com", "example.com"],
  headers: [{ name: "X-A", operation: "set", value: "1" }],
}];
check("canonical form of the Test C profile has ONE domain",
  canonicalizeProfiles(dupProfile)[0].domains.length === 1);
check("the duplicate set serializes identically to the singleton set",
  serializeProfiles(dupProfile)
    === serializeProfiles([{ ...dupProfile[0], domains: ["example.com"] }]));

// The contract's own two rules, checked against the shape that violated them.
check("identical SETS serialize to identical bytes regardless of duplicates",
  serializeProfiles([{ ...dupProfile[0], domains: ["a.com", "a.com", "b.com"] }])
    === serializeProfiles([{ ...dupProfile[0], domains: ["b.com", "a.com"] }]));
check("export -> import -> export stays byte-identical with duplicates in",
  serializeProfiles(dupProfile)
    === attempt(() => serializeProfiles(parseProfilesFile(serializeProfiles(dupProfile)))));
check("import accepts duplicates and returns the deduped set",
  attempt(() => parseProfilesFile(validDoc(dupProfile))[0].domains.join(",")) === "example.com");

// COUNT AGREEMENT (finding 7's second half). The chip list renders
// profile.domains and the status line counts referencedDomains(); they
// disagreed on screen. After normalization the two count the same thing, which
// is the property to pin — the popup wiring itself needs chrome.* and lives in
// SMOKE.md.
const canonicalDup = canonicalizeProfiles(dupProfile);
check("chip count equals status-line domain count after normalization",
  canonicalDup[0].domains.length === referencedDomains(canonicalDup).length);
check("count agreement holds across profiles sharing a domain",
  canonicalizeProfiles([
    { ...dupProfile[0], id: 1, domains: ["a.com", "a.com"] },
    { ...dupProfile[0], id: 2, domains: ["a.com", "B.com", "b.com"] },
  ]).reduce((n, p) => n + p.domains.length, 0) === 3);

// ------------------------------------- over-cap import refusal (finding 6)
// The cap is enforced at parse time so an over-cap file is REFUSED rather than
// accepted and silently truncated at the wire. Counted in profiles because
// grant state is unknowable here — see the comment in parseProfilesFile.

// HEADER NAMES ARE DISTINCT PER PROFILE, AND THAT CHANGED IN v0.1.5. Until
// FINDING-021 these were all `X-A` on `a.com`, which is now a 5000-way
// collision and would be refused before the cap check could be reached. The
// cap fixtures were never about collisions, so the fixture moved rather than
// the checks. Distinct NAMES rather than distinct DOMAINS on purpose:
// findCollisions() buckets by header name first, so distinct names give 5000
// buckets of one and the fixture stays fast, while distinct domains sharing
// one header name would give one bucket of 5000 and a quadratic domain scan.
const bulk = (n, from = 1) => Array.from({ length: n }, (_, i) => ({
  id: from + i, name: `p${from + i}`, domains: ["a.com"],
  headers: [{ name: `X-A-${from + i}`, operation: "set", value: "1" }],
}));

check("the cap constant is 5000, the unsafe-rule limit not the 30000 one",
  MAX_UNSAFE_DYNAMIC_RULES === 5000);
// Caught, not propagated. An off-by-one in the cap comparison makes this call
// THROW, and an uncaught throw aborts the run, prints no FAIL lines, and reads
// downstream as "no check caught this mutation" — which is how a missing test
// and a crashing one become indistinguishable. Same reason as the generated-id
// round-trip check below. Every success-expecting parseProfilesFile call in
// this suite must catch.
check("a file at exactly the cap is ACCEPTED",
  attempt(() => parseProfilesFile(validDoc(bulk(MAX_UNSAFE_DYNAMIC_RULES))).length)
    === MAX_UNSAFE_DYNAMIC_RULES);
// Anchored on the deliberate sentence rather than an incidental fragment. The
// first version of these checks matched "more than the", which was a phrase
// nobody had chosen on purpose — rewording the message for clarity during the
// smoke run broke two checks that were not testing behaviour at all. Assert on
// the part of the message the reader is meant to act on.
checkThrows("a file one over the cap is REFUSED",
  () => parseProfilesFile(validDoc(bulk(MAX_UNSAFE_DYNAMIC_RULES + 1))),
  "The most that can be applied");
checkThrows("the refusal states the actual profile count",
  () => parseProfilesFile(validDoc(bulk(MAX_UNSAFE_DYNAMIC_RULES + 1))),
  String(MAX_UNSAFE_DYNAMIC_RULES + 1));
checkThrows("the refusal states the limit",
  () => parseProfilesFile(validDoc(bulk(MAX_UNSAFE_DYNAMIC_RULES + 1))),
  String(MAX_UNSAFE_DYNAMIC_RULES));

// The count check runs BEFORE per-profile validation, so an over-cap file gets
// the cap reason rather than a complaint about profile 4,312. Pinned because
// the ordering is the difference between an actionable message and a confusing
// one, and a later refactor could reorder it without noticing.
checkThrows("an over-cap file with a bad profile still reports the CAP",
  () => parseProfilesFile(validDoc([
    ...bulk(MAX_UNSAFE_DYNAMIC_RULES),
    { id: 99999, name: "", domains: ["a.com"],
      headers: [{ name: "X-A", operation: "set", value: "1" }] },
  ])), "The most that can be applied");

// A4 regression guard: refusal is a throw, so no caller can have applied
// anything. parseProfilesFile is pure — it returns a value or throws, and
// never mutates its input.
const preserved = validDoc(bulk(MAX_UNSAFE_DYNAMIC_RULES + 1));
let threw = false;
try { parseProfilesFile(preserved); } catch { threw = true; }
check("an over-cap import throws rather than returning a truncated set", threw);
check("an over-cap import leaves the source document untouched",
  JSON.parse(preserved).profiles.length === MAX_UNSAFE_DYNAMIC_RULES + 1);

// The instruction tells the reader HOW MANY to remove, so it has to be
// computed. A hardcoded "remove 1" would be wrong for every file but the
// smallest overage, and wrong advice is worse than none.
checkThrows("the refusal says how many profiles to remove (singular)",
  () => parseProfilesFile(validDoc(bulk(MAX_UNSAFE_DYNAMIC_RULES + 1))),
  "at least 1 profile from");
checkThrows("the overage scales, and pluralises",
  () => parseProfilesFile(validDoc(bulk(MAX_UNSAFE_DYNAMIC_RULES + 3))),
  "at least 3 profiles from");

// ------------------------------------ cross-profile collisions (FINDING-021)
// Two profiles whose domains overlap and which both write the same header have
// no defined winner; v0.1.5 refuses the configuration rather than letting
// Chrome pick. OBS-C10 is the banked before-state — one silent winner on the
// wire — and it deliberately does NOT establish which mechanism chose it,
// which is precisely why refusal was taken over precedence.

const validEntry = (entry) => validateHeaderEntry(entry).valid;
const cProf = (id, name, domains, headers) => ({ id, name, domains, headers });
const setH = (name, value = "1") => ({ name, operation: "set", value });
const rmH = (name) => ({ name, operation: "remove" });

// --- domain overlap, which is label-suffix containment and not string suffix

check("F021: a domain overlaps itself",
  domainsOverlap("example.com", "example.com"));
check("F021: an apex overlaps its subdomain (DNR matches both)",
  domainsOverlap("example.com", "api.example.com"));
check("F021: overlap is symmetric",
  domainsOverlap("api.example.com", "example.com"));
check("F021: an apex overlaps a deep subdomain",
  domainsOverlap("example.com", "a.b.c.example.com"));

// THE CHECK THIS GROUP EXISTS FOR. "notexample.com".endsWith("example.com") is
// true, and a string-suffix test would refuse two configurations that cover
// disjoint hosts. The leading dot is the whole fix. Part 11 step 4's
// confusable control is the wire version of this.
check("F021: a SUFFIX CONFUSABLE does not overlap",
  !domainsOverlap("example.com", "notexample.com"));
check("F021: the confusable case is symmetric too",
  !domainsOverlap("notexample.com", "example.com"));
check("F021: unrelated domains do not overlap",
  !domainsOverlap("example.com", "example.org"));
check("F021: sibling subdomains do not overlap",
  !domainsOverlap("a.example.com", "b.example.com"));
check("F021: an IP literal overlaps only itself",
  domainsOverlap("127.0.0.1", "127.0.0.1") &&
  !domainsOverlap("127.0.0.1", "127.0.0.2"));
check("F021: domain LISTS overlap if any pair does",
  domainListsOverlap(["a.test", "example.com"], ["z.test", "api.example.com"]));
check("F021: disjoint domain lists do not overlap",
  !domainListsOverlap(["a.test", "b.test"], ["c.test", "d.test"]));

// --- which header names count

check("F021: header names are compared case-insensitively",
  headerNamesFor(cProf(1, "p", ["a.test"], [setH("X-Api-Key")]), validEntry)
    .has("x-api-key"));
// An entry profileToRule() would filter out never reaches DNR, so it cannot
// collide with anything. Counting it would refuse a configuration over a
// header that was never going to apply.
check("F021: an INVALID header entry does not count toward a collision",
  headerNamesFor(cProf(1, "p", ["a.test"], [setH("bad header name")]), validEntry)
    .size === 0);

// --- the pairwise scan

const collidingPair = [
  cProf(1, "Alpha", ["example.com"], [setH("X-H", "A")]),
  cProf(2, "Beta", ["example.com"], [setH("X-H", "B")]),
];
const found = findCollisions(collidingPair, validEntry);
check("F021: two profiles writing one header on one domain collide",
  found.length === 1 && found[0].header === "x-h");
check("F021: the collision names BOTH profiles, lower id first",
  found[0].profileIds[0] === 1 && found[0].profileIds[1] === 2);
check("F021: both sides are marked, never one",
  collidingProfileIds(found).has(1) && collidingProfileIds(found).has(2));

// The FINDING-018 surface: these two did not overlap before subdomain
// matching shipped and do now, which is what makes existing 0.1.4 installs
// reachable by this and why the build-time half is not optional.
check("F021: apex and subdomain profiles collide (the 018-enlarged surface)",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [setH("X-H")]),
    cProf(2, "Beta", ["api.example.com"], [setH("X-H")]),
  ], validEntry).length === 1);
check("F021: suffix-confusable domains do NOT collide",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [setH("X-H")]),
    cProf(2, "Beta", ["notexample.com"], [setH("X-H")]),
  ], validEntry).length === 0);
check("F021: different headers on the same domain do not collide",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [setH("X-A")]),
    cProf(2, "Beta", ["example.com"], [setH("X-B")]),
  ], validEntry).length === 0);

// --- v0.2.0: SIDE, in the validator and the rule builder. These two had to
// change together: while profileToRule() put every valid entry into
// requestHeaders, making the validator accept a response entry would have
// applied it on the WRONG SIDE, silently.

const rRespH = { name: "X-H", operation: "set", value: "1", side: "response" };
const rReqH = { name: "X-H", operation: "set", value: "1" };

check("F021/side: an absent side is valid (every 0.1.x entry)",
  validateHeaderEntry(rReqH).valid);
check("F021/side: an explicit request/response side is valid",
  validateHeaderEntry({ ...rReqH, side: "request" }).valid &&
  validateHeaderEntry(rRespH).valid);
// sideOf() would read this as "request" and apply a header the file did not ask for.
check("F021/side: an unrecognised side is REJECTED, not defaulted",
  !validateHeaderEntry({ ...rReqH, side: "trailer" }).valid &&
  validateHeaderEntry({ ...rReqH, side: "trailer" }).reason.includes("trailer"));
check("F021/side: side is case-sensitive, an uppercase side is rejected",
  !validateHeaderEntry({ ...rReqH, side: "Response" }).valid);

// Append stays request-only: the allowlist was verified for REQUEST headers,
// and reusing it for responses would assert a list nobody checked.
check("F021/side: append on a RESPONSE header is refused",
  !validateHeaderEntry({ name: "Accept", operation: "append", value: "x", side: "response" }).valid);
check("F021/side: append on an allowlisted REQUEST header still works",
  validateHeaderEntry({ name: "Accept", operation: "append", value: "x" }).valid);
check("F021/side: the request allowlist still bites on the request side",
  !validateHeaderEntry({ name: "X-Nope", operation: "append", value: "x" }).valid);

// --- the rule builder
const reqOnlyRule = profileToRule({ id: 1, headers: [rReqH] }, ["a.test"]);
check("F021/side: a request-only profile emits requestHeaders and NO responseHeaders",
  reqOnlyRule.action.requestHeaders?.length === 1 &&
  reqOnlyRule.action.responseHeaders === undefined);

const respOnlyRule = profileToRule({ id: 2, headers: [rRespH] }, ["a.test"]);
// OPTIONAL CHAINING IS DELIBERATE. A check that THROWS on a missing array is
// worse than one that fails: mutate-collisions.py counts "^FAIL:" lines, so a
// crashing check scores zero failures and the mutant is reported as UNCOVERED
// when it was in fact caught. Found by running the harness, not by reading.
check("F021/side: a response entry lands in responseHeaders, never requestHeaders",
  respOnlyRule.action.responseHeaders?.length === 1 &&
  respOnlyRule.action.responseHeaders?.[0].header === "X-H" &&
  respOnlyRule.action.requestHeaders === undefined);

const bothRule = profileToRule({ id: 3, headers: [rReqH, rRespH] }, ["a.test"]);
check("F021/side: a mixed profile emits both arrays, each with only its own side",
  bothRule.action.requestHeaders?.length === 1 &&
  bothRule.action.responseHeaders?.length === 1);
check("F021/side: a profile whose only entries are invalid still returns null",
  profileToRule({ id: 4, headers: [{ name: "bad header", operation: "set", value: "1" }] },
    ["a.test"]) === null);

// --- v0.2.0: SIDE. A request header and a response header of the same name
// are two different writes at two different moments. DNR puts them in
// separate arrays and they cannot contend for one value, so refusing them
// would be a fail-closed FALSE POSITIVE on a configuration that is fine.

const respH = (name, value = "1") => ({ name, operation: "set", value, side: "response" });

// The upgrade path. Every 0.1.x profile has entries with no `side` at all.
check("F021/side: a missing side reads as request",
  sideOf({ name: "X-H", operation: "set", value: "1" }) === "request");
check("F021/side: an unrecognised side reads as request, not a third bucket",
  sideOf({ name: "X-H", side: "trailer" }) === "request" &&
  sideOf({ name: "X-H", side: "RESPONSE" }) === "request");
check("F021/side: an explicit response side is preserved",
  sideOf(respH("X-H")) === "response");

check("F021/side: the key carries the side, the name does not",
  headerKeysFor(cProf(1, "p", ["a.test"], [respH("X-Api-Key")]), validEntry)
    .has("response\u0000x-api-key") &&
  headerNamesFor(cProf(1, "p", ["a.test"], [respH("X-Api-Key")]), validEntry)
    .has("x-api-key"));

// THE POINT OF THE WHOLE CHANGE.
check("F021/side: same name on DIFFERENT sides does NOT collide",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [setH("X-H", "A")]),
    cProf(2, "Beta", ["example.com"], [respH("X-H", "B")]),
  ], validEntry).length === 0);
check("F021/side: same name on the RESPONSE side still collides",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [respH("X-H", "A")]),
    cProf(2, "Beta", ["example.com"], [respH("X-H", "B")]),
  ], validEntry).length === 1);
check("F021/side: a legacy (sideless) profile collides with an explicit request one",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [{ name: "X-H", operation: "set", value: "A" }]),
    cProf(2, "Beta", ["example.com"], [{ name: "X-H", operation: "set", value: "B", side: "request" }]),
  ], validEntry).length === 1);

const bothSides = findCollisions([
  cProf(1, "Alpha", ["example.com"], [setH("X-H", "A"), respH("X-H", "A")]),
  cProf(2, "Beta", ["example.com"], [setH("X-H", "B"), respH("X-H", "B")]),
], validEntry);
check("F021/side: one name colliding on BOTH sides is TWO collisions",
  bothSides.length === 2 &&
  bothSides.every((c) => c.header === "x-h") &&
  bothSides.map((c) => c.side).join(",") === "request,response");
// 9d: pins the PROPERTY (order follows the values) rather than the current
// output. Entries are deliberately declared response-first so that bucket
// insertion order disagrees with the required output order.
const sideOrder = findCollisions([
  cProf(1, "Alpha", ["example.com"], [respH("X-H", "A"), setH("X-H", "A")]),
  cProf(2, "Beta", ["example.com"], [respH("X-H", "B"), setH("X-H", "B")]),
], validEntry);
check("F021/side: collision order does not depend on header order within a profile",
  sideOrder.map((c) => c.side).join(",") === "request,response");
check("F021/side: the record carries the bare name, never the internal key",
  bothSides.every((c) => !c.header.includes("\u0000")));

// Prose. The old sentence said "on the same request" unconditionally, which
// is false for a response-side collision — 9f: state the property.
const respOnly = findCollisions([
  cProf(1, "Alpha", ["example.com"], [respH("X-H", "A")]),
  cProf(2, "Beta", ["example.com"], [respH("X-H", "B")]),
], validEntry);
const respMsg = describeCollisions(respOnly, 1, (id) => ({ 1: "Alpha", 2: "Beta" })[id]);
check("F021/side: a response collision says response, not request",
  respMsg.includes("the same response") && !respMsg.includes("the same request"));
check("F021/side: a request collision still says request",
  describeCollisions(found, 1, () => "Alpha").includes("the same request"));

const mixedMsg = describeCollisions(bothSides, 1, (id) => ({ 1: "Alpha", 2: "Beta" })[id]);
check("F021/side: a mixed collision claims no single moment",
  mixedMsg.includes("the same exchange") &&
  !mixedMsg.includes("the same request") && !mixedMsg.includes("the same response"));
check("F021/side: a mixed collision labels each side so the pair is distinguishable",
  mixedMsg.includes('"x-h" (request)') && mixedMsg.includes('"x-h" (response)'));
// Noise control: the single-sided common case must NOT be labelled.
check("F021/side: a single-sided collision is not labelled with its side",
  !describeCollisions(found, 1, () => "Alpha").includes("(request)"));
check("F021/side: the save refusal is side-aware too",
  describeSaveRefusal(respOnly, 1, (id) => "X").includes("the same response"));
check("F021/side: the import refusal is side-aware too",
  describeImportRefusal(respOnly, (id) => "X").includes("the same response"));

// STRICT, by decision 2026-09-01. Both of these have an order-independent
// outcome and are refused anyway, because "two profiles disagree about this
// header" is a rule that fits in the popup and stays honest. If the false
// positive is ever reported, THESE are the two checks that change.
check("F021 (strict): two REMOVES of the same header collide",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [rmH("X-H")]),
    cProf(2, "Beta", ["example.com"], [rmH("X-H")]),
  ], validEntry).length === 1);
check("F021 (strict): IDENTICAL set values still collide",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [setH("X-H", "same")]),
    cProf(2, "Beta", ["example.com"], [setH("X-H", "same")]),
  ], validEntry).length === 1);

// One profile may name a header twice — set-then-append is supported and
// canonical.js freezes header order to preserve it. Within one profile the
// entries land in one rule's ordered array, so DNR applies them
// deterministically and there is nothing ambiguous to refuse.
check("F021: a repeat WITHIN one profile is not a collision",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [setH("X-H", "a"), setH("X-H", "b")]),
  ], validEntry).length === 0);

// ADDED BECAUSE A MUTATION PASS FOUND IT UNPINNED. Removing the `a.id === b.id`
// guard in findCollisions() failed ZERO checks, which first read as an
// equivalent mutant: headerNamesFor() returns a SET, so a profile enters each
// bucket at most once and the guard is unreachable for well-formed input.
// Probing it directly showed that reading was wrong — the guard DOES change
// behaviour when the caller passes a duplicate id, and nothing exercised that
// path. parseProfilesFile() rejects duplicate ids, so this is storage-shaped
// input, which A2 says to treat as untrusted. A profile must never be refused
// for colliding with itself.
check("F021: a duplicate id does not collide with itself",
  findCollisions([
    cProf(1, "Alpha", ["example.com"], [setH("X-H", "a")]),
    cProf(1, "Alpha again", ["example.com"], [setH("X-H", "b")]),
  ], validEntry).length === 0);

// THE TWO-INPUTS PROPERTY (the FINDING-020 lesson, applied ahead of time).
// The same profiles asked about GRANTED domains rather than configured ones
// produce no collision, because no rule would register. Collapsing the two
// questions into one is what this pins.
check("F021: the same pair does not collide when the granted set is empty",
  findCollisions(collidingPair.map((p) => ({ ...p, domains: [] })), validEntry)
    .length === 0);

const multi = findCollisions([
  cProf(2, "Beta", ["example.com"], [setH("X-B"), setH("X-A")]),
  cProf(1, "Alpha", ["example.com"], [setH("X-A"), setH("X-B")]),
], validEntry);
check("F021: collisions are sorted deterministically by header then id",
  multi.length === 2 && multi[0].header === "x-a" && multi[1].header === "x-b" &&
  multi[0].profileIds[0] === 1);

// --- the sentence the user reads

const sentence = describeCollisions(found, 1, (id) => ({ 1: "Alpha", 2: "Beta" })[id]);
// Anchored on what was DECIDED — the header and the other profile's name are
// what make the state actionable. FINDING-006's lesson: do not freeze prose
// nobody chose on purpose.
check("F021: the marker names the header", sentence.includes('"x-h"'));
check("F021: the marker names the OTHER profile", sentence.includes('"Beta"'));
check("F021: the marker says the profile is not applying",
  sentence.toLowerCase().includes("not applying"));
check("F021: an unresolvable name falls back to the id, never 'undefined'",
  describeCollisions(found, 1, () => null).includes("profile 2"));
check("F021: a profile in no collision gets no marker",
  describeCollisions([], 1, () => "Alpha") === "");

// --- the import refusal

const collidingDoc = validDoc([
  { id: 1, name: "Alpha", domains: ["example.com"], headers: [setH("X-H", "A")] },
  { id: 2, name: "Beta", domains: ["api.example.com"], headers: [setH("X-H", "B")] },
]);
checkThrows("F021: a colliding import is REFUSED", () =>
  parseProfilesFile(collidingDoc), "overlapping domains");
checkThrows("F021: the import refusal names the header", () =>
  parseProfilesFile(collidingDoc), '"x-h"');
check("F021: a non-colliding import is still accepted",
  attempt(() => parseProfilesFile(validDoc([
    { id: 1, name: "Alpha", domains: ["example.com"], headers: [setH("X-A")] },
    { id: 2, name: "Beta", domains: ["example.com"], headers: [setH("X-B")] },
  ])).length) === 2);
// Unnormalized case would miss its own overlap if the check ran on raw input.
checkThrows("F021: the import check normalizes case before comparing", () =>
  parseProfilesFile(validDoc([
    { id: 1, name: "Alpha", domains: ["EXAMPLE.com"], headers: [setH("X-H", "A")] },
    { id: 2, name: "Beta", domains: ["example.com"], headers: [setH("x-h", "B")] },
  ])), "overlapping domains");

// REASON PRECEDENCE. A file with a malformed header should be rejected for the
// malformed header, and an over-cap file for the cap — not for a collision
// computed from either. Same ordering the cap refusal already follows.
checkThrows("F021: a malformed header outranks a collision as the reason", () =>
  parseProfilesFile(validDoc([
    { id: 1, name: "Alpha", domains: ["example.com"], headers: [setH("X-H", "A")] },
    { id: 2, name: "Beta", domains: ["example.com"], headers: [{ name: "bad name", operation: "set", value: "B" }] },
  ])), "header name");
checkThrows("F021: the cap outranks a collision as the reason", () =>
  parseProfilesFile(validDoc([
    ...bulk(MAX_UNSAFE_DYNAMIC_RULES + 1),
    { id: 99991, name: "Alpha", domains: ["example.com"], headers: [setH("X-H", "A")] },
    { id: 99992, name: "Beta", domains: ["example.com"], headers: [setH("X-H", "B")] },
  ])), "The most that can be applied");

// --- FINDING-026: the write-path refusals are their own sentences
//
// The card marker was reused verbatim on two surfaces it was not written for.
// Every word of it is true on the card and two of its claims are false on the
// write paths: nothing was saved, and nothing was imported. THE FACTS ARE
// SHARED, THE SENTENCE IS NOT.
//
// WHAT IS PINNED HERE IS THE DECIDED PART, per FINDING-006. The two facts that
// make a refusal actionable — which header, which other profile — plus the
// three defects OBS-D3 and OBS-D8 recorded: a false claim about application,
// the problem stated twice, and punctuation the caller supplies again. Prose
// beyond that is free to change.

const names2 = (id) => ({ 1: "Alpha", 2: "Beta" })[id];
const saveMsg = describeSaveRefusal(found, 1, names2);

check("F026: the save refusal names the header", saveMsg.includes('"x-h"'));
check("F026: the save refusal names the OTHER profile", saveMsg.includes('"Beta"'));
// The finding itself. On this surface either the profile does not exist yet or
// the STORED version is unchanged and still applying, so any claim about
// application is false whichever way it points.
check("F026: the save refusal makes NO claim about applying",
  !/appl(y|ies|ying|ied)/i.test(saveMsg));
check("F026: the save refusal says it did not save",
  /not saved/i.test(saveMsg));
check("F026: the save refusal names the way out",
  /change the/i.test(saveMsg));
check("F026: the save refusal is NOT the card marker",
  saveMsg !== describeCollisions(found, 1, names2));
check("F026: an unresolvable name falls back to the id in the save refusal",
  describeSaveRefusal(found, 1, () => null).includes("profile 2"));
check("F026: a profile in no collision gets no save refusal",
  describeSaveRefusal([], 1, names2) === "");
// Grammar is in scope here rather than being fussiness: two of the three
// defects this finding records ARE grammar, produced by composing a new
// sentence around a helper written for a different surface.
const savePlural = describeSaveRefusal(multi, 1, (id) => ({ 1: "A", 2: "B" })[id]);
check("F026: the save refusal agrees in number with two headers",
  savePlural.includes("headers") && savePlural.includes(" are "));

const importMsg = describeImportRefusal(found, names2);

check("F026: the import refusal names the header", importMsg.includes('"x-h"'));
check("F026: the import refusal names BOTH profiles",
  importMsg.includes('"Alpha"') && importMsg.includes('"Beta"'));
check("F026: the import refusal makes NO claim about applying",
  !/appl(y|ies|ying|ied)/i.test(importMsg));
// popup.js renders every parse failure as `Import failed: ${err.message}.`, so
// a message that terminates itself produces the observed "..".
check("F026: the import refusal does not terminate itself",
  !/[.!?]$/.test(importMsg));
// The duplication defect, made decidable: the old message paired a wrapper
// sentence with the card marker and said "overlapping domain(s)" in both.
check("F026: the import refusal states the overlap ONCE",
  (importMsg.match(/overlapping domain/g) || []).length === 1);
check("F026: unresolvable names fall back to ids in the import refusal",
  describeImportRefusal(found, () => null).includes("profile 1") &&
  describeImportRefusal(found, () => null).includes("profile 2"));
check("F026: no collisions produce no import refusal",
  describeImportRefusal([], names2) === "");
// One pair is named and the rest are counted. Listing every pair is what the
// 360px popup cannot hold; saying nothing about them would overstate what the
// message covers.
const importMulti = describeImportRefusal(multi, (id) => ({ 1: "A", 2: "B" })[id]);
check("F026: further collisions are counted, not silently dropped",
  /1 further collision\b/.test(importMulti) && !/further collisions/.test(importMulti));

// End to end through the real throw site, which is where the defect was seen.
let importThrew = "";
try { parseProfilesFile(collidingDoc); } catch (err) { importThrew = err.message; }
check("F026: the THROWN import message makes no claim about applying",
  importThrew !== "" && !/appl(y|ies|ying|ied)/i.test(importThrew));
check("F026: the THROWN import message does not terminate itself",
  importThrew !== "" && !/[.!?]$/.test(importThrew));
// The duplication defect at the REAL throw site. The helper being clean does
// not stop canonical.js pairing it with a wrapper sentence again, which is
// exactly how the defect arose the first time.
check("F026: the THROWN import message states the overlap ONCE",
  (importThrew.match(/overlapping domain/g) || []).length === 1);
// OBS-D8 verbatim ended "...one of them..". Rendered the way popup.js renders
// it, the message must end in exactly one full stop.
check("F026: rendered as popup.js renders it, there is one terminal period",
  /[^.]\.$/.test(`Import failed: ${importThrew}.`));

// ------------------------------- static popup wiring (finding 10 motivated)
// The suite cannot execute popup.js — it needs chrome.* — but it CAN read it.
// $("some-id") resolving to null is a silent failure: the listener is never
// attached, the button does nothing, and no error is raised anywhere. Finding
// 10 adds four new element ids across two files, which is exactly the shape
// that goes wrong when one file is committed and the other is not.
//
// This is the cheap end of the static architecture check still owed from the
// claim -> evidence table, and it is the first check here that reaches
// popup.js at all.

const popupJsRaw = readFileSync(new URL("../extension/popup/popup.js", import.meta.url), "utf8");
const popupHtmlRaw = readFileSync(new URL("../extension/popup/popup.html", import.meta.url), "utf8");

// A PATTERN MATCH CANNOT TELL A USE FROM A MENTION, and every scan below is a
// pattern match over source text. Comments are stripped first, at the point of
// reading, so no individual check has to remember to. Two mutants, both taken
// on the shipped v0.1.6 tree, are why:
//   - documenting the rejected `min(600px, 100vh)` form verbatim in the CSS
//     comment above the body rule turned "the body cap uses NO viewport unit"
//     RED with the stylesheet unchanged. A guard firing on its own explanation.
//   - deleting `overflow-y: auto` and `min-height: 0` from `main` while a
//     comment named them kept the suite at 273/273 GREEN. That is FINDING-022
//     reinstated behind a passing tripwire, which is the direction that costs
//     something.
// Strings are NOT stripped: popup.js's element ids and class names live in
// string literals and are the thing being scanned.
const stripJsComments = (src) => {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += src[i++];
      while (i < src.length) {
        if (src[i] === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i]; if (src[i++] === q) break;
      }
      continue;
    }
    out += src[i++];
  }
  return out;
};
const popupJs = stripJsComments(popupJsRaw);
const popupHtml = popupHtmlRaw.replace(/<!--[\s\S]*?-->/g, "");

const referencedIds = [...popupJs.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);
const declaredIds = new Set(
  [...popupHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
);
const danglingIds = [...new Set(referencedIds)].filter((id) => !declaredIds.has(id));

check("popup.js references at least a dozen element ids (the scan works)",
  new Set(referencedIds).size >= 12);
check(`every element id popup.js references exists in popup.html${
  danglingIds.length ? " — dangling: " + danglingIds.join(", ") : ""}`,
  danglingIds.length === 0);

// Named explicitly so the finding 10 wiring fails loudly rather than as part
// of a generic list, and in BOTH files — a confirm whose buttons exist only in
// the markup is a dialog that cannot be dismissed.
for (const id of ["delete-confirm", "delete-confirm-text", "delete-cancel", "delete-proceed"]) {
  check(`finding 10: #${id} is declared in popup.html`, declaredIds.has(id));
  check(`finding 10: #${id} is referenced by popup.js`, referencedIds.includes(id));
}

// Same hazard one level down, and the export notice is what surfaced it: a
// class toggled from JS but never defined in the stylesheet fails SILENTLY.
// The element gets the class, nothing looks different, and no error is raised
// — so a message intended to read as neutral would have shipped in the error
// colour, or in no colour at all. Only literal class names are scanned;
// anything computed is out of reach here and belongs in the smoke test.
const toggledClasses = [
  ...new Set([...popupJs.matchAll(/classList\.(?:add|remove|toggle)\("([^"]+)"/g)]
    .map((m) => m[1])),
];
const styleBlock = ((popupHtml.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1]).replace(/\/\*[\s\S]*?\*\//g, "");
const definedClasses = new Set(
  [...styleBlock.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])
);
const undefinedClasses = toggledClasses.filter((c) => !definedClasses.has(c));

check("popup.js toggles at least four classes (the scan works)",
  toggledClasses.length >= 4);
check(`every class popup.js toggles is defined in popup.html${
  undefinedClasses.length ? " — undefined: " + undefinedClasses.join(", ") : ""}`,
  undefinedClasses.length === 0);

// ------------------------------- the chip recovery path (FINDING-002 / 028)
//
// v0.1.7 MADE THIS LOAD-BEARING AND THAT IS WHY IT IS PINNED HERE. Before the
// FINDING-028 narrowing, a denied or legacy domain had two ways back: the chip,
// and an unrelated Edit -> Save re-firing request() for everything ungranted.
// The second was the defect. The chip is now the ONLY in-app recovery, so it
// stops being a convenience and becomes the thing that keeps FINDING-002
// fixed. If a tidying pass ever makes the ungranted chip a plain span, a
// denied domain becomes a dead end again and nothing else in this suite would
// notice.
//
// STATED HONESTLY, THE SAME WAY THE F022 CHECKS ARE: these read popup.js as
// text. They prove the button and the request call are present in the source.
// They do NOT prove a dialog appears — that is a browser question, it is the
// v0.1.7 runbook's first row, and sitting C's "a denied origin still prompts
// on the next request" is the banked half of it.
check("F002: the ungranted domain chip is a BUTTON, not a span",
  /createElement\(granted \? "span" : "button"\)/.test(popupJs));
check("F002: the chip's click handler requests THAT DOMAIN only",
  /permissions\.request\(\{\s*origins: originsForDomain\(domain\),?\s*\}\)/.test(popupJs));

// ------------------------------------------- popup containment (FINDING-022)
//
// WHAT THESE CHECKS ARE, STATED PLAINLY SO NOBODY MISTAKES THEM FOR THE
// EVIDENCE. They read the stylesheet as text. They prove the declarations are
// present; they do NOT prove the popup lays out correctly, because nothing
// here renders anything. The oracle for FINDING-022 is visual and lives in
// SMOKE.md Part 14 — toggle and status line visible at a profile count well
// past the OBS-D12 threshold of three.
//
// They earn their place as a TRIPWIRE. The narrow fix is four declarations
// spread across three rules, and any one of them going missing reinstates the
// bug silently: the popup still renders, still works, and simply scrolls its
// header away again at some profile count nobody is currently looking at.
// min-height: 0 is the most fragile of the four — it looks redundant, it is
// the one a tidying pass would delete, and without it overflow-y never
// engages at all.

check("F022: the popup body is height-bounded",
  /body\s*\{[^}]*max-height:/.test(styleBlock));
// OBS-E1. The cap was `min(600px, 100vh)` and collapsed the popup to 107px at
// ZERO profiles, clipping Add profile — because `vh` resolves against a
// viewport this popup derives from its own content height, and `min()` takes
// the smaller term. A cap that feeds on its own output is not a cap.
//
// STATED HONESTLY: this check exists because a browser said so. Nothing in
// the suite could have predicted it, the six declaration checks below all
// passed against the broken build, and they were right to — they read the
// stylesheet as text. What this pins is the specific defect, so it cannot
// return silently.
check("F022: the body cap uses NO viewport unit",
  !/body\s*\{[^}]*max-height:[^;]*\b\d*\.?\d*v(h|w|min|max)\b/.test(styleBlock));
check("F022: the popup body is a flex COLUMN",
  /body\s*\{[^}]*flex-direction:\s*column/.test(styleBlock));
check("F022: main is the scrolling region",
  /(?:^|[\s}])main\s*\{[^}]*overflow-y:\s*auto/.test(styleBlock));
check("F022: main can shrink below its content (min-height: 0)",
  /(?:^|[\s}])main\s*\{[^}]*min-height:\s*0/.test(styleBlock));
check("F022: the header does not shrink",
  /(?:^|[\s}])header\s*\{[^}]*flex:\s*none/.test(styleBlock));
check("F022: the status line does not shrink",
  /(?:^|[\s}])footer\s*\{[^}]*flex:\s*none/.test(styleBlock));
// Structural, not stylistic: pinning works because these two are SIBLINGS of
// the scrolling region. A footer moved inside <main> scrolls with the list and
// every declaration above stays true while the fix stops working.
check("F022: the toggle and the status line sit OUTSIDE the scrolling region",
  /<header[\s\S]*<main[\s\S]*<\/main>[\s\S]*<footer/.test(popupHtml));

// ------------------------------------------- migration wording (FINDING-023)
//
// The chip's `title` carries the only explanation of why a chip is gray under
// migration, and it does not render on hover — so that explanation was
// reachable through DevTools and nowhere else. The fix moves the distinction
// into the notice, which names the visual marker.
//
// THE TWO HALVES MUST AGREE, and this is the whole reason it is checked here
// rather than left to the browser row: the notice's word is only true while
// `.migrating` is the thing carrying an underline. Change the stylesheet and
// the sentence becomes a wrong instruction with nothing to catch it.
check("F023: the migration notice names the visual marker",
  /underlined domain/.test(popupJs));
check("F023: .migrating is what carries the underline the notice names",
  /\.migrating\s*\{[^}]*text-decoration:\s*underline/.test(styleBlock));
// An ordinary ungranted chip must NOT be underlined, or "underlined" stops
// picking out the migrating ones and the notice over-counts.
check("F023: a plain ungranted chip is marked by its BORDER, not an underline",
  /button\.domain\s*\{[^}]*border-style:\s*dashed/.test(styleBlock) &&
  !/button\.domain\s*\{[^}]*text-decoration/.test(styleBlock));

// ------------------------------------------ badge honesty (finding 4, A5)
// The narrow half only: does the badge stop asserting ON when registration
// failed. activeRuleCount and the four-state scheme are NOT here on purpose.

check("enabled + successful sync shows ON",
  computeBadge({ enabled: true, syncOk: true }) === BADGE_ON);
check("disabled + successful sync shows OFF",
  computeBadge({ enabled: false, syncOk: true }) === BADGE_OFF);
check("enabled + FAILED sync does not show ON",
  computeBadge({ enabled: true, syncOk: false }) !== BADGE_ON);
check("enabled + FAILED sync shows the failure badge",
  computeBadge({ enabled: true, syncOk: false }) === BADGE_FAILED);
check("DISABLED + failed sync does not show OFF either (clear may have failed)",
  computeBadge({ enabled: false, syncOk: false }) === BADGE_FAILED);
check("badge text fits Chrome's badge (<= 4 chars) in every state",
  [BADGE_ON, BADGE_OFF, BADGE_FAILED].every((b) => b.text.length <= 4));
check("every badge state carries a colour",
  [BADGE_ON, BADGE_OFF, BADGE_FAILED].every((b) => /^#[0-9a-f]{6}$/i.test(b.color)));

check("status line says applying when enabled and synced",
  describeSync({ enabled: true, syncOk: true }) === "applying");
check("status line says paused when disabled and synced",
  describeSync({ enabled: false, syncOk: true }) === "paused");
check("status line does not claim applying after a failed sync",
  describeSync({ enabled: true, syncOk: false }) !== "applying");
check("status line does not claim paused after a failed sync",
  describeSync({ enabled: false, syncOk: false }) !== "paused");
check("failed-sync text names the failure rather than a stale good state",
  describeSync({ enabled: true, syncOk: false }).includes("failed"));
check("missing sync state defaults to ok, not to a claimed failure",
  DEFAULT_SYNC_STATE.ok === true &&
  computeBadge({ enabled: true, syncOk: DEFAULT_SYNC_STATE.ok }) === BADGE_ON);

// ------------------------------------------- serial queue (finding 5)
// Async, so these run after the synchronous checks above and their results
// are asserted before the count is read (see the await at the bottom).

async function queueChecks() {
  const order = [];
  const slow = (id, ms) => () =>
    new Promise((res) => setTimeout(() => { order.push(id); res(id); }, ms));

  // A later, faster call must not finish before an earlier, slower one.
  const q1 = createSerialQueue((fn) => fn()());
  const a = q1(() => slow("a", 30));
  const b = q1(() => slow("b", 0));
  await Promise.all([a, b]);
  check("later call cannot overtake an earlier one", order.join(",") === "a,b");

  // A rejected run must not poison the chain.
  let ran = 0;
  let caught = null;
  const q2 = createSerialQueue(
    async (shouldThrow) => {
      ran++;
      if (shouldThrow) throw new Error("boom");
    },
    (err) => { caught = err.message; }
  );
  await q2(true);
  await q2(false);
  check("a failed run does not stop later runs", ran === 2);
  check("the failure is surfaced to onError", caught === "boom");

  // Serialization must hold under a burst, which is the real shape: five
  // listeners can fire before the worker suspends.
  const seen = [];
  let active = 0;
  let overlapped = false;
  const q3 = createSerialQueue(async (id) => {
    active++;
    if (active > 1) overlapped = true;
    await new Promise((res) => setTimeout(res, 1));
    seen.push(id);
    active--;
  });
  await Promise.all([1, 2, 3, 4, 5].map((n) => q3(n)));
  check("no two runs overlap under a burst", !overlapped);
  check("burst runs complete in enqueue order", seen.join("") === "12345");

  // Missing onError must not itself throw.
  const q4 = createSerialQueue(async () => { throw new Error("silent"); });
  await q4();
  check("omitting onError is safe", true);
}

// --------------------------------------------- debounce (finding 8)
// Rate control for the popup's storage listener. renderList costs one
// permissions.contains() per chip, so coalescing a burst is load-bearing.

async function debounceChecks() {
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  let runs = 0;
  const d1 = createDebounced(() => { runs++; }, 5);
  d1(); d1(); d1(); d1(); d1();
  check("a burst has not run yet at schedule time", runs === 0);
  await sleep(30);
  check("a burst of five collapses into ONE run", runs === 1);

  // Trailing edge with the LAST arguments — a leading-edge implementation
  // would render the state mid-burst with nothing scheduled to correct it.
  let seen = null;
  const d2 = createDebounced((v) => { seen = v; }, 5);
  d2("first"); d2("second"); d2("last");
  await sleep(30);
  check("the trailing run uses the LAST arguments", seen === "last");

  // Calls separated by more than the window are distinct runs, or the listener
  // would coalesce unrelated events indefinitely under steady traffic.
  let spaced = 0;
  const d3 = createDebounced(() => { spaced++; }, 5);
  d3();
  await sleep(30);
  d3();
  await sleep(30);
  check("calls outside the window run separately", spaced === 2);

  // A rejected async task must reach onError rather than becoming an unhandled
  // rejection: nothing awaits a task scheduled from a timer.
  let caught = null;
  const d4 = createDebounced(async () => { throw new Error("boom"); }, 5,
    (err) => { caught = err.message; });
  d4();
  await sleep(30);
  check("an async rejection is surfaced to onError", caught === "boom");

  // A synchronous throw must not escape the timer callback either.
  let syncCaught = null;
  const d5 = createDebounced(() => { throw new Error("sync"); }, 5,
    (err) => { syncCaught = err.message; });
  d5();
  await sleep(30);
  check("a synchronous throw is surfaced to onError", syncCaught === "sync");

  // Omitting onError must be safe, matching createSerialQueue's contract.
  const d6 = createDebounced(async () => { throw new Error("quiet"); }, 5);
  d6();
  await sleep(30);
  check("omitting onError is safe for the debouncer too", true);

  // Scheduling again AFTER a run has fired must still work — a debouncer that
  // fails to reset its timer handle fires once and then goes deaf, which in
  // the popup would look exactly like finding 8 never having been fixed.
  let revived = 0;
  const d7 = createDebounced(() => { revived++; }, 5);
  d7();
  await sleep(30);
  d7();
  await sleep(30);
  check("the debouncer still fires after an earlier run completed",
    revived === 2);
}

await queueChecks();
await debounceChecks();

// -------------------------------------------------------------- result

const total = passed + failed;
if (failed > 0) {
  console.error(`selftest: ${failed} of ${total} checks FAILED`);
  process.exit(1);
}
if (total !== EXPECTED_CHECKS) {
  console.error(
    `selftest: count tripwire — ${total} checks ran, expected ${EXPECTED_CHECKS}. ` +
      `If checks were added or removed deliberately, update EXPECTED_CHECKS in the same commit.`
  );
  process.exit(1);
}
console.log(`selftest: ${total}/${EXPECTED_CHECKS} checks passed`);
