// The UI's DECISIONS, with no React and no DOM.
//
// These moved out of the component because three mutants proved they were
// unreachable: every defect sitting B fixed could be reintroduced with
// `npm test` staying green, since the only oracle was a browser sitting run by
// hand. That is the core/adapter argument one level down — an adapter should
// own rendering, and a decision the CLI would have to make identically does not
// belong somewhere only a browser can reach.
//
// It also makes F7 answerable. Applying responses out of order is trivial here
// and impossible against a real server, so the question the browser sitting
// recorded as NOT REACHED can be measured.

// Which request the UI should show when the session loads.
//
// An UNKNOWN id is selected anyway, deliberately: falling back to the first
// request would show a different request than the one asked for, silently,
// which is the failure this product exists to prevent. Selecting it lets the
// core refuse with selection.unknown and the ids it does have — what the CLI
// does.
export function initialSelection(session) {
  if (!session || !Array.isArray(session.requests)) return null;
  if (session.requestId !== null && session.requestId !== undefined) {
    return session.requestId;
  }
  return session.requests.length > 0 ? session.requests[0].id : null;
}

// What a 200 response from /api/resolve means.
//
// A core refusal arrives as 200 with an `error` document, because the CALL
// succeeded and its result is a refusal — the same distinction the CLI draws
// when a 4xx response exits 0. Reading `prepared` off an error document is what
// produced a blank white page on every refusal.
export function classifyResponse(body) {
  if (body && body.error) return { kind: "refusal", error: body.error };
  if (body && body.prepared) return { kind: "result", result: body };
  return { kind: "unusable" };
}

// Whether a response that has just arrived may be applied.
//
// The last SELECTION must win, not the last response to ARRIVE. Without this a
// slow response for an abandoned selection overwrites a newer one, and the user
// is shown a request they are no longer looking at — in a tool whose whole
// subject is that what you see is what would be sent.
export function makeSequencer() {
  let issued = 0;
  let applied = 0;
  return {
    begin: () => ++issued,
    mayApply: (ticket) => {
      if (ticket !== issued) return false;
      applied = ticket;
      return true;
    },
    get lastApplied() { return applied; },
  };
}
