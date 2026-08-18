---
name: mcp
description: MCP (Model Context Protocol) servers and clients on the 2026-07-28 stateless
  specification, including tools, resources, prompts, input schemas, transports, extensions, and
  privilege boundaries. Use when creating or modifying an MCP server, defining its tools, migrating
  from a pre-2026-07-28 spec, or debugging its transport. Do not use for unrelated HTTP APIs or
  ordinary application services.
---

# mcp

An MCP server is an API whose client is a model. Two consequences: every tool description is part
of the functional contract, and input is never trustworthy.

Target the **2026-07-28 specification**. It is the largest revision since launch and **contains
breaking changes** — pre-2026-07-28 implementations do not work unmodified.

## The core is stateless

The `initialize`/`initialized` handshake and the `Mcp-Session-Id` header are **gone**. Every request
travels on its own, carrying its protocol version, client identity and client capabilities in
`_meta`. Any instance behind a load balancer can serve any request.

- **Send protocol version and client metadata in `_meta` on every request.**
- **State becomes an explicit handle**, not transport metadata: a tool returns a workflow ID,
  basket token or similar, and the model passes it back as a normal argument on later calls. State
  is visible to the model instead of hidden in the protocol.
- **Capability discovery is on demand** via the `server/discover` RPC, not a one-time handshake.

## Multi round-trip requests (MRTR)

Server-initiated requests that needed a held-open stream are replaced. A server returns
`resultType: "input_required"` naming the answers it needs; the client retries the call with them
in `inputResponses`. This is how mid-call confirmations and parameter collection work over
stateless HTTP.

## Transport

- **stdio:** local process, one client. **`stdout` belongs to the protocol** — one debugging
  `print()` corrupts the JSON-RPC stream and the server stops responding with an error that does
  not identify the cause. Every log goes to `stderr`:
  ```python
  logging.basicConfig(stream=sys.stderr, level=os.getenv("LOG_LEVEL", "INFO"))
  ```
- **Streamable HTTP:** remote, multiple clients, ordinary round-robin load balancing. Requests must
  carry the `Mcp-Method` and `Mcp-Name` headers so gateways and WAFs route and meter on headers
  instead of parsing JSON bodies.
- **Legacy HTTP+SSE is deprecated.** Migrate to Streamable HTTP.
- **Never disable TLS verification by default.** Shipping `SSL_VERIFY=false` accepts
  man-in-the-middle attacks in every installation.

## Deprecated, with roughly twelve months of life

They still work, but plan the migration now:

| Deprecated | Replacement |
|---|---|
| Roots | Explicit path parameters on tools, or server configuration |
| Sampling (server invoking the client's LLM) | Integrate directly with an LLM provider API |
| Protocol-level Logging | `stderr` or OpenTelemetry |
| HTTP+SSE transport | Streamable HTTP |
| Dynamic Client Registration (DCR) | Client ID Metadata Documents (CIMD) |

## Tools

- **One tool, one capability.** A `manage` tool with an `action` parameter branching eight ways is
  eight badly packaged tools: the model picks the wrong branch and permissions cannot be granted
  independently.
- **The description states when to use it**, not only what it does — the model decides from that
  text.
- **Strict schema:** concrete types, `enum` for closed sets, explicit `required`. A `string`
  parameter that really accepts four values is a latent error.
- **Fail clearly on invalid input.** An explanatory error beats guessing, because the model can
  correct itself from a good message.
- **Structured output** when the client consumes fields; free-form text forces parsing.
- **Bound output volume.** A tool that can return 50,000 lines needs pagination or a limit, or it
  consumes the client's whole context window.

## List caching

`tools/list`, `prompts/list`, `resources/list` and `resources/read` responses carry `ttlMs` and
`cacheScope`. Set them deliberately: too long serves stale capabilities, absent means every client
re-lists on every request.

## Extensions

The core stays small and capabilities arrive as named extensions.

- **Tasks** (`io.modelcontextprotocol/tasks`) moved out of experimental core for long-running work,
  polled with `tasks/get` and `tasks/update`. Use it instead of blocking a call synchronously.
- **MCP Apps** for server-rendered interactive UI inside a chat interface.
- A single `subscriptions/listen` stream replaces HTTP GET notifications.

## Authorization

Aligned with OAuth 2.1 and OpenID Connect:

- Authorization servers return the `iss` parameter per RFC 9207, and **clients must validate it**.
- Clients set `application_type` at registration.
- **Client credentials are bound to the issuer that minted them** — no reuse across authorization
  servers.
- Enterprise-Managed Authorization (EMA) exists for centralized provisioning; evaluate it for
  organizational deployments.

## Privilege

The server can do everything its tools permit, with no other implicit limit.

- Read-only by default. Write access is a decision, not an accident.
- Minimum network, disk and process scope. If it needs one directory, do not grant the system.
- Never accept a path without validating it against an allowed root: resolve the canonical path and
  confirm it stays inside, accounting for `..`, symlinks and absolute paths. This matters more now
  that Roots is deprecated and paths arrive as ordinary tool parameters.
- Secrets come from the environment, never a tool parameter — parameters are recorded in
  conversation history, and now also in state handles the model passes around.
- Mark destructive operations so the client can request confirmation.

## Resources and prompts

- Resource URIs are stable and predictable; changing them between versions breaks clients.
- Resources are read-only by definition. Use a tool when writing is required.
- A prompt must not depend on hidden mutable state unless the contract says so — and with a
  stateless core there is no transport-level place to hide it.

## Structure

- **Separate transport from logic.** The function doing the work must be testable without starting
  the server; if it is not, the two are mixed. Statelessness makes this easier, not optional.
- Give shared connections and clients an **explicit lifecycle**. A module-level client opens at
  import and never closes — a leak.
- Beware context managers that do not close what you expect: `with pyodbc.connect(...)` commits or
  rolls back but **does not close the connection**. Close it explicitly.

## Anti-patterns

- `print()` on stdio. Repeated because it is the most common and hardest failure to diagnose.
- Holding server-side state keyed by connection, which no longer exists.
- Assuming the same instance handles the next request.
- A generic tool accepting arbitrary SQL or commands.
- Weak validation letting malformed input into application logic.
- Ad hoc text where clients need fields.
- Credentials passed as tool parameters, or reused across issuers.
- Exposing every capability of the underlying library "while we are here".

## Verification

- Start the server and list its tools — this minimum test catches most startup failures.
- Execute one valid invocation and one invalid-input invocation.
- **Send two related requests to different instances** (or restart between them) and verify the
  flow still works — that is what statelessness actually promises.
- If permission boundaries exist, try to cross them with an out-of-root path or a write in
  read-only mode.
- With stdio, verify no log reached `stdout`.
