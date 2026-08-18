---
name: javascript
description: ECMAScript 2025 JavaScript runtime semantics, including ESM, async/await, equality,
  immutability, iteration, and errors. Use when writing .js/.mjs files or reasoning about the
  runtime behavior of TypeScript. Do not use for TypeScript's type system; use typescript instead.
---

# javascript

Target **ECMAScript 2025** for new language features. Check the project's Node/browser target before
using newer built-ins such as `RegExp.escape`, `Promise.try`, or `Float16Array`.

Runtime semantics, which TypeScript does not change because its types disappear at compile time.
The type system lives in `typescript`.

**Nearly every strange JavaScript bug involves asynchrony, `this`, or equality.** When behavior
makes no sense, inspect those three before questioning the business logic.

## Modules

- ESM in new code. `import` declarations are hoisted and resolved **before** any code runs, so they
  cannot be conditional — use dynamic `await import()` for that.
- ESM has no `__dirname`/`__filename`:
  ```js
  const here = path.dirname(fileURLToPath(import.meta.url));  // node:url, node:path
  ```
- Prefer named exports to `export default`; they autocomplete, rename and search reliably.

## Async

- `async` marks the function, `await` marks the wait. An `async` function always returns a promise.
- **`forEach` does not wait.** `arr.forEach(async x => await f(x))` starts everything and continues
  immediately. `for...of` for sequential, `Promise.all` for parallel.
- **`Promise.all` rejects on the first failure** and leaves the rest running uncollected. Use
  `Promise.allSettled` when every result is required.
- An unhandled rejected promise terminates modern Node. Every async path needs error handling.
- Do not mix callbacks and promises in one function.

## Equality and values

- Always `===`. `==` coerces (`0 == ""` is `true`).
- `NaN !== NaN`. Test with `Number.isNaN(x)`, not global `isNaN`, which coerces first.
- `typeof null === "object"` is a historical language bug, not an error in your reasoning.
- `??` means "null or undefined", `||` means "falsy". They differ for `0` and `""` — a common
  default-value bug.
- `?.` stops the property chain; it does not catch errors. `a?.b()` still throws when `b` is not a
  function.

## Immutability

`const` freezes the binding, not the value. `sort`, `reverse`, `splice` and `push` mutate;
`map`, `filter`, `slice` and `concat` do not. Copy shared data:

```js
const next = { ...prev, count: prev.count + 1 };
const sorted = [...items].sort();     // sort() mutates the original
```

Mutating an array observed elsewhere is a classic source of distant failures.

## Errors

- Throw `Error` or a subclass, never a string — without `Error` there is no stack trace.
- Custom error classes for cases callers must distinguish.
- A `catch` that does nothing is an authorized bug. If intentional, say why in a comment.
- Preserve the original when wrapping: `throw new PaymentError("payment failed", { cause: err })`.

## `this`

Arrow functions capture `this` from their defining scope; normal functions receive it from how
they are called. Passing a method as a callback loses it: `arr.map(obj.method)` fails,
`arr.map(x => obj.method(x))` works.

## Anti-patterns

- `var` in new code.
- `async` callbacks inside `forEach`.
- Empty `catch {}`.
- `JSON.parse(JSON.stringify(x))` for cloning — loses `Date`, `Map`, `undefined`, functions. Use
  `structuredClone`.
- Comparing objects with `===` expecting value equality.
- Mutating function arguments.
- `parseInt(x)` without a radix.

## Verification

- Exercise the async path and verify effect **order**, not only the final result.
- Force a rejection and verify it is handled without terminating the process.
- When shared data changes, verify you did not mutate data another consumer reads.
