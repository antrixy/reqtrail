// The browser half of `reqtrail ui`. It renders what the core returned and
// decides nothing: no substitution, no normalization, no masking. If a question
// can be answered here that the CLI also has to answer, it belongs in the core,
// and the parity test is what makes that a property rather than an intention.
//
// `dangerouslySetInnerHTML` is PROHIBITED, and the prohibition is tested — see
// test/ui.mjs. Every value below reaches the DOM as a React child, which is
// escaped. Buying the escaping guarantee and leaving the escape hatch open
// would be paying for nothing.

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// The session token arrives in the URL FRAGMENT, which browsers never send to a
// server. It is read once and removed from the address bar, so it survives in
// no history entry, no Referer and no log.
function takeToken() {
  const hash = window.location.hash;
  const token = hash.startsWith("#token=") ? hash.slice(7) : "";
  window.history.replaceState(null, "", window.location.pathname);
  return token;
}

const TOKEN = takeToken();

// Every API call is a POST, including the read-only one. Measured in sitting A:
// a browser sends no `Origin` header on a same-origin GET, so a GET endpoint
// cannot be defended by an Origin check. The verb is a security property here,
// not a REST opinion.
async function api(path, body = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!res.ok) {
    throw new Error(parsed?.error?.message ?? `request failed (${res.status})`);
  }
  return parsed;
}

function RequestLine({ prepared }) {
  return (
    <pre className="wire">
      <code>
        <span className="method">{prepared.method}</span>{" "}
        <span className="url">{prepared.url}</span>
        {prepared.headers.map((h, i) => (
          <span key={i} className="header-line">
            {"\n"}
            <span className="hname">{h.name}</span>
            <span className="colon">: </span>
            <span className="hvalue">{h.value}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}

// What a span produced. The arrow appears only when normalization changed the
// bytes, so its presence is itself the signal — the same rule the CLI follows,
// because the two views are meant to be read against each other.
function Produced({ row }) {
  if (!row.resolved) return <span className="unresolved">unresolved</span>;
  if (row.secret) return <span className="masked">{row.produced}</span>;
  if (row.empty) return <span className="quiet">empty</span>;
  if (row.transformed) {
    return (
      <>
        <span className="before">{JSON.stringify(row.substituted)}</span>
        <span className="arrow"> → </span>
        <span className="after">{row.produced}</span>
      </>
    );
  }
  return <span>{row.produced ?? row.substituted}</span>;
}

function Substitutions({ rows }) {
  if (rows.length === 0) {
    return <p className="quiet">This request substitutes nothing. Every part of
      it is written out in the file.</p>;
  }
  return (
    <table className="prov">
      <thead>
        <tr>
          <th scope="col">Where</th>
          <th scope="col">Reference</th>
          <th scope="col">Source</th>
          <th scope="col">Produced</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="where">{row.path}</td>
            <td className="ref">{row.reference}</td>
            <td className="source">
              {row.source}
              {!row.resolved && <span className="quiet"> (not set)</span>}
            </td>
            <td className="produced"><Produced row={row} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Notices({ result }) {
  const items = [
    ...result.unresolved.map((u) => ({ kind: "unresolved", ...u })),
    ...result.warnings.map((w) => ({ kind: "warning", ...w })),
  ];
  if (items.length === 0) return null;
  return (
    <ul className="notices">
      {items.map((n, i) => (
        <li key={i} className={n.kind}>
          <span className="where">{n.path}</span> {n.cause}
        </li>
      ))}
    </ul>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/api/session")
      .then((s) => {
        setSession(s);
        if (s.requests.length > 0) setSelected(s.requests[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const load = useCallback((id) => {
    setResult(null);
    setError(null);
    api("/api/resolve", { requestId: id })
      .then(setResult)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { if (selected !== null) load(selected); }, [selected, load]);

  if (error && session === null) {
    return <main className="shell"><p className="failure">{error}</p></main>;
  }
  if (session === null) return <main className="shell"><p className="quiet">Reading the workspace…</p></main>;

  return (
    <main className="shell">
      <header>
        <h1>reqtrail</h1>
        <p className="file">{session.file}</p>
        <p className="standing">
          This release resolves requests and shows them. It does not send them.
        </p>
      </header>

      <nav aria-label="Requests in this file">
        {session.requests.map((r) => (
          <button
            key={r.id}
            type="button"
            className={r.id === selected ? "req current" : "req"}
            aria-current={r.id === selected ? "true" : undefined}
            onClick={() => setSelected(r.id)}
          >
            <span className="id">{r.id}</span>
            {r.name && <span className="name">{r.name}</span>}
          </button>
        ))}
      </nav>

      {error && <p className="failure">{error}</p>}

      {result && (
        <article>
          <h2>The request that would be sent</h2>
          <RequestLine prepared={result.prepared} />
          {!result.urlResolved && (
            <p className="quiet">
              The URL is shown as written. It contains an unresolved reference,
              so it has not been normalized.
            </p>
          )}

          <h2>Substitutions</h2>
          <Substitutions rows={result.provenance} />

          <Notices result={result} />
        </article>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
