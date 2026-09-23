// RAW RECEIVER ON ::1. The oracle for the IPv6 wire rows —
// EXACT-TRANSPORT-PREREGISTRATION.md D5, increment 4.
//
// WHY A SEPARATE FILE AND NOT A PARAMETER ON THE SLICE-0 RECEIVER: `slice0/` is
// frozen, and the bar for editing it is stated in `slice0/README.md` — a repair
// that moves no verdict, not new capability. Binding another address is new
// capability. The capture loop is therefore duplicated, as
// `test/tls-receiver.mjs` duplicated it for TLS. If the copies ever disagree
// about what "verbatim" means, that is a finding, not a refactor.
//
// (Increment 4 briefly broke that rule by adding a `host` parameter to
// `slice0/receiver.mjs`. It was reverted byte-identical in increment 5; the
// evidence file records it.)
//
// A BIND THAT FAILS REJECTS, naming nothing but the error, so the caller can
// report which address could not be bound instead of crashing from an event
// handler. Compare captures with `parseCapture` from `slice0/receiver.mjs`,
// which parses only for comparison.
import net from "node:net";

export function startIpv6Receiver() {
  const captures = [];
  const server = net.createServer((socket) => {
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
  });
  return new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(0, "::1", () =>
      res({ port: server.address().port, captures, close: () => server.close() })
    );
  });
}
