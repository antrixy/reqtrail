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

**Anyone who trusts this certificate outside the suite trusts a key that is
public.** Never point `NODE_EXTRA_CA_CERTS` at it in a real shell profile.
