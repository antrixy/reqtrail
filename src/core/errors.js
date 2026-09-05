// Errors are DATA, not prose. The core returns or throws a structure carrying
// a stable code, a field path and a cause; adapters render it. A thrown string
// would force a machine consumer to parse English and would put semantics in
// the CLI adapter that the core is supposed to hold.
//
// Two classes, and the distinction is the exit-code split in SPEC:
//
//   Refusal    the prepared request cannot be built at all. Thrown.
//   Unresolved a reference has no value. NOT thrown — the prepared request is
//              still built and displayed, marked unresolved, and `resolve`
//              exits 1. Refusing to SHOW the request removes the diagnosis,
//              which is the product.

export class Refusal extends Error {
  constructor(detail) {
    super(detail.cause);
    this.name = "Refusal";
    this.detail = { code: detail.code, path: detail.path, cause: detail.cause };
    if (detail.variable !== undefined) this.detail.variable = detail.variable;
  }
}

export const refuse = (code, path, cause, variable) => {
  throw new Refusal({ code, path, cause, variable });
};
