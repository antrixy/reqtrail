// TLS-TERMINATING RAW RECEIVER. The oracle for P-WIRE over HTTPS —
// HTTPS-PREREGISTRATION §2 and §3, increment 2.
//
// It terminates TLS and does NOTHING ELSE. The decrypted stream is captured
// verbatim, exactly as `slice0/receiver.mjs` captures a plain socket. It is not
// `https.createServer`, for the same reason that file is not
// `http.createServer`: a parsing server normalizes the request line and header
// block before you see them, and the harness would end up measuring itself.
// Compare captures with `parseCapture` from `slice0/receiver.mjs`, which parses
// only for comparison.
//
// WHY A SEPARATE FILE AND NOT AN OPTION ON THE SLICE-0 RECEIVER: `slice0/` is
// frozen, and the bar for editing it is stated in `slice0/README.md`. Adding
// TLS is not a repair, so it does not meet that bar. The capture loop below is
// therefore duplicated rather than shared. If the two ever disagree about what
// "verbatim" means, that is a finding, not a refactor.
//
// THE RECEIVER IS NOT AN ORACLE FOR SENDABILITY. Like the slice-0 receiver, it
// accepts whatever is written at it. It also does NOT verify the CLIENT. Server
// certificate verification is the client's job, and P-VERIFY is proved by the
// client refusing this server when it is not trusted, not by anything here.
//
// TRUST. The certificate is the test-only fixture in `tls/` (see its README).
// A client trusts it only through `NODE_EXTRA_CA_CERTS`, per D1. Nothing here
// changes what any client trusts.
//
// ADDRESS. Bound to 127.0.0.1, like the slice-0 receiver. The certificate names
// `DNS:localhost` only, so:
//   - `https://localhost:<port>` is the trusted path. Node >=22 (the `engines`
//     floor) tries both address families for `localhost`, so a host that
//     resolves it to ::1 first still reaches 127.0.0.1.
//   - `https://127.0.0.1:<port>` is the altname-mismatch path.
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "tls");
export const TEST_CERT_PATH = join(TLS_DIR, "TEST-ONLY-localhost-cert.pem");
const TEST_KEY_PATH = join(TLS_DIR, "TEST-ONLY-localhost-key.pem");

export function startTlsReceiver() {
  const captures = [];
  const server = tls.createServer(
    { key: readFileSync(TEST_KEY_PATH), cert: readFileSync(TEST_CERT_PATH) },
    (socket) => {
      const chunks = [];
      socket.on("data", (d) => {
        chunks.push(d);
        const buf = Buffer.concat(chunks);
        const end = buf.indexOf("\r\n\r\n");
        if (end === -1) return;                       // header block incomplete
        captures.push(buf.subarray(0, end + 4));      // verbatim bytes, headers only
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
        );
      });
      socket.on("error", () => {});
    },
  );
  // A client that rejects the certificate aborts the handshake, and that
  // surfaces here. It is the expected outcome of every untrusted row, so it is
  // swallowed here and asserted on the client side.
  server.on("tlsClientError", () => {});
  return new Promise((res) => {
    server.listen(0, "127.0.0.1", () =>
      res({ port: server.address().port, captures, close: () => server.close() })
    );
  });
}
