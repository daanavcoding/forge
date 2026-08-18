---
name: node
description: Node.js 24 LTS and 26 Current runtime patterns for node:* modules, filesystems, streams, processes,
  environment variables, node:test, and packaging. Use when writing Node CLIs, scripts, or
  services. Do not use for language-level JavaScript semantics; use javascript instead.
---

# node

Target **Node.js 24 LTS** for new production code; Node.js 26 is the current release line. Preserve
the repository's declared runtime floor and gate newer APIs when the project supports older Node.

The runtime, not the language. Language rules live in `javascript`.

**Node runs application code on one thread.** Any long synchronous operation — `readFileSync` on a
large file, a loop over ten million elements, expensive hashing — blocks *every* concurrent
request. Acceptable in a script; an incident in a server.

## The standard library covers more than expected

| Requirement | Built-in |
|---|---|
| HTTP requests | global `fetch` |
| Parse CLI arguments | `node:util` → `parseArgs` |
| Tests | `node:test` + `node:assert` |
| Hash, HMAC, UUID | `node:crypto` (`randomUUID`) |
| Paths | `node:path` |
| `.env` variables | `node --env-file=.env` |
| Watch files | `node:fs` → `watch` |

Always use the `node:` prefix — it identifies runtime modules and prevents an npm package from
impersonating them.

## Filesystem

- `node:fs/promises` by default. `*Sync` only in one-step scripts or at startup, never in request
  handling.
- `path.join`/`path.resolve`; concatenating with `/` breaks on Windows.
- **Validate every external path against a root:** resolve its canonical path and confirm it stays
  inside, otherwise deny. `..` and symlinks escape apparently bounded directories.
- Stream large files instead of `readFile`. Loading 2 GB into memory works until it does not.
- Write important files atomically: temporary file, then `rename`. An interrupted `writeFile`
  leaves partial content.

## Processes

- Prefer `spawn` to `exec`. `exec` invokes a shell, so interpolated input becomes command
  injection; `spawn` with an argument array has no shell syntax to interpret.
- Never interpolate user input into a command.
- Check the actual exit code. Nonempty `stderr` is not necessarily failure, and empty `stderr` is
  not success.
- Set a timeout; a hung child hangs its parent.

## Configuration and secrets

- Read config from environment variables and validate **at startup**. Failing early with a clear
  message beats an `undefined` failure three hours later.
- No secrets in source or the repository. Ignore `.env` in Git; ship `.env.example` with keys and
  no values.
- Do not log the whole config object — eventually it logs a password.

## Errors and shutdown

- Log `unhandledRejection` and `uncaughtException`, then **exit**. Continuing with corrupted state
  is worse than stopping.
- Handle `SIGTERM`: stop accepting connections, finish active work, close the database, exit.
  Without it, every deployment cuts requests in progress.
- Add a shutdown timeout and force exit if resources do not close in time.

## Tests

`node:test` is built in — no framework, config or dependency. Import `test` from `node:test` and
`assert` from `node:assert/strict`; `node --test` discovers files automatically.

A test that still passes with broken logic is not a test. Deliberately break the logic once and
verify the test fails.

## Anti-patterns

- `readFileSync` inside a request handler.
- `exec` with a string built by concatenation.
- A dependency for what `node:util` or `fetch` already does.
- `process.exit()` during active work; it cuts pending I/O and truncates output.
- Catching `unhandledRejection` and continuing.
- `^` version ranges in a deployed application. Use the lockfile and `npm ci`.
- Modules that open connections or read files at import time.

## Verification

- Actually run the script or start the server and check its exit code.
- Run `npm test` and retain the output.
- Start with a required environment variable absent and verify a clear failure.
- If graceful shutdown exists, send `SIGTERM` and verify closure without interrupting work.
