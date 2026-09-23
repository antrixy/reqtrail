# Test-only TLS fixture — NOT A SECRET, NOT FOR ANY OTHER USE

`TEST-ONLY-localhost-key.pem` is a private key, committed on purpose. It exists
so the suite can run a local HTTPS server that reqtrail verifies **without**
reqtrail ever gaining a way to skip certificate verification.
`HTTPS-PREREGISTRATION.md`, D1, gives the ruling and the rejected alternatives.

- **One self-signed certificate that is its own trust anchor.** It is valid for
  `DNS:localhost` only and carries no IP address. Connecting to `127.0.0.1` with
  it fails `ERR_TLS_CERT_ALTNAME_INVALID`, and the altname-mismatch row relies
  on that.
- **Tests trust it through `NODE_EXTRA_CA_CERTS`**, set on a child process
  running the real binary. Nothing in `src/` reads this directory, and `send`
  takes no trust parameter.
- **Valid until 2126.** A selftest check reads `notAfter` and fails well before
  expiry, so the fixture cannot silently expire into a red suite.
- **Excluded from the npm package**, because `test/` is not in `files`.

Generated 2026-09-22 with an EC P-256 key:

    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
      -keyout TEST-ONLY-localhost-key.pem -out TEST-ONLY-localhost-cert.pem \
      -days 36500 -subj "/CN=localhost (reqtrail TEST ONLY)" \
      -addext "subjectAltName=DNS:localhost" \
      -addext "basicConstraints=critical,CA:TRUE"

## The second fixture — IPv6 loopback, added for 0.5.0

`TEST-ONLY-ipv6-loopback-cert.pem` and its key serve the IPv6-over-TLS rows
(`EXACT-TRANSPORT-PREREGISTRATION.md` D8). It is valid for `IP:::1` only. It is
a second fixture, not a new SAN on the first, because the IPv4 altname-mismatch
row needs the localhost certificate to name no IP. A selftest check pins both
SANs and this certificate's `notAfter`.

Generated 2026-09-23 with the same command and that SAN:

    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
      -keyout TEST-ONLY-ipv6-loopback-key.pem -out TEST-ONLY-ipv6-loopback-cert.pem \
      -days 36500 -subj "/CN=::1 (reqtrail TEST ONLY)" \
      -addext "subjectAltName=IP:::1" \
      -addext "basicConstraints=critical,CA:TRUE"

**Anyone who trusts either certificate outside the suite trusts a key that is
public.** Never point `NODE_EXTRA_CA_CERTS` at one in a real shell profile.
