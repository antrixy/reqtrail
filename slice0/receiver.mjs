// Raw-socket receiver. NOT http.createServer — see SLICE-0-PREREGISTRATION §2.
// A parsed server normalizes the request line and header block before you see
// it, which would make this harness measure itself. That is the F15 failure
// mode from import-fidelity-spike, one project earlier.
import net from "node:net";

// `host` defaults to IPv4 loopback, as every caller before 0.5.0 assumed. The
// IPv6 rows pass "::1" (EXACT-TRANSPORT-PREREGISTRATION.md D5).
export function startReceiver(host = "127.0.0.1") {
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
  // A bind that fails REJECTS rather than throwing out of an event handler, so
  // a caller can say which address could not be bound.
  return new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(0, host, () =>
      res({ port: server.address().port, captures, close: () => server.close() })
    );
  });
}

// Parse ONLY for comparison, and keep everything the wire showed:
// name casing, order, and repeated occurrences.
export function parseCapture(buf) {
  const text = buf.toString("latin1");
  const lines = text.split("\r\n");
  const [method, target, version] = lines[0].split(" ");
  const headers = [];
  for (const line of lines.slice(1)) {
    if (!line) break;
    const i = line.indexOf(":");
    headers.push({ name: line.slice(0, i), value: line.slice(i + 1).replace(/^ /, "") });
  }
  return { method, target, version, headers, raw: text };
}
