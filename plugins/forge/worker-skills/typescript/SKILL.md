---
name: typescript
description: TypeScript 6.0+ type-system rules for strict mode, inference, generics, discriminated
  unions, unknown versus any, utility types, and trust boundaries. Use when writing or modifying
  .ts/.tsx files. Do not use for runtime language semantics; use javascript instead.
---

# typescript

Target **TypeScript 6.0** for new code unless the repository pins another compiler. Keep the
repository's `tsconfig.json` as the source of truth and do not use new syntax without checking its
configured target and module resolution.

The **type system**. Runtime behavior (modules, async, equality, errors) lives in `javascript`.

**Types disappear at compilation.** `as User` checks nothing; it tells the compiler to be quiet.
Everything entering from outside the program — network, disk, `JSON.parse`, forms — is `unknown`
until a runtime check proves otherwise.

```ts
const user = (await res.json()) as User;            // false assurance: fails three layers later
const user = UserSchema.parse(await res.json());    // real assurance (zod, valibot, io-ts...)
```

## Configuration

`"strict": true` is non-negotiable; if the project lacks it, enable it and fix the errors — each
one reveals a defect that already existed. Add `noUncheckedIndexedAccess` so `arr[0]` is
`T | undefined`, because the array can be empty and often is.

## `any` versus `unknown`

For TypeScript 6, set `exactOptionalPropertyTypes` and `noUncheckedSideEffectImports` explicitly in
projects that need reproducible behavior. The compiler's new defaults also make `types` an explicit
allowlist and change `rootDir` inference, so add `"types": ["node", ...]` and `rootDir` when the
project relies on those globals or output paths.

`any` disables checking and spreads silently to everything it touches. `unknown` requires narrowing
before use. When the type is not known, use `unknown`. If `any` is genuinely necessary, confine it
to one line with a comment explaining why.

## Let inference work

- **Annotate:** exported parameters, public return types, data structures.
- **Do not annotate:** locals, obvious returns, callbacks. `const n: number = 5` is noise.

An explicit return type on an exported function stops an internal change from silently altering its
public signature.

## Discriminated unions over independent booleans

Make impossible states unrepresentable.

```ts
type State = { loading: boolean; error?: string; data?: User };   // bad: allows loading+error+data
type State =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: User };
```

In a `switch` over the discriminant, a `never` default forces every new case to be handled:

```ts
default: {
  const _exhaustive: never = state;   // compilation error when a variant is missing
  return _exhaustive;
}
```

## Generics

Only for a real input/output relationship — `pick<T, K extends keyof T>(o: T, k: K): T[K]` is
justified. A generic used once with the same concrete type is speculative; remove it. Constrain
with `extends` rather than leaving it open.

## Utility types

`Partial`, `Pick`, `Omit`, `Record`, `ReturnType`, `Awaited` keep definitions synchronized;
copying guarantees divergence. Use `satisfies` to check a type **without** losing inference:

```ts
const config = { host: "localhost", port: 8080 } satisfies Config;
config.port;   // literal 8080, not `number`
```

## Anti-patterns

- `as` to silence an error instead of fixing it.
- `any` in a public signature, contaminating every caller.
- `@ts-ignore` without a comment. Use `@ts-expect-error`, which fails when the error disappears.
- Import assertions (`asserts { type: ... }`) in new code; use import attributes (`with { type: ... }`).
- Duplicating interfaces an SDK already exports.
- Scattered `!` non-null assertions; each is an unchecked promise.
- TypeScript enums in new code — a literal union gives the same types without emitted code.
- `object` or `{}` as a type; neither means what it appears to mean.

## Verification

- `tsc --noEmit` clean, without `skipLibCheck` hiding project errors.
- Run `tsc` through the project `tsconfig.json`; do not pass source filenames beside it. Use
  `--ignoreConfig` only when deliberately compiling outside the project configuration.
- Zero new `any` in the diff.
- External data validated at runtime, not asserted with `as`.
- Exhaustiveness enforced in every `switch` over a discriminated union.
