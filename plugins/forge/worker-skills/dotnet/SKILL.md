---
name: dotnet
description: C# and .NET backends, dependency injection, asynchronous I/O, persistence, domain
  boundaries, and API tests. Use when changing .NET services, endpoints, or domain logic.
  Do not use for unrelated languages or frontend work.
---

# .NET

Read the project's target framework, SDK selection, nullable settings, and architecture before
choosing APIs. Preserve its supported runtime and naming conventions; do not turn a feature into
a framework or architecture migration.

## Boundaries and composition

- Keep business rules independent of HTTP and persistence details. Follow the repository's actual
  project-reference boundaries rather than imposing a fixed set of assembly names.
- Use the existing composition root. ASP.NET Core's built-in dependency injection is a normal
  default: scoped services for request-bound state, transient for lightweight independent work,
  singleton only for thread-safe shared services. Never capture a scoped DbContext in a singleton.
- Add an interface or layer for a real boundary, not for every class. Do not introduce a generic
  repository over EF Core solely to wrap its existing operations.
- Prefer ordinary enums for closed named values, records for value-oriented data, and richer
  domain types when behavior or invariants require them. Pure static helpers are valid.
- Keep types internal unless intentionally part of a public assembly contract.

## Async and resources

- Await I/O end to end and pass CancellationToken through HTTP and database operations.
  Avoid `.Result`, `.Wait()`, and Task.Run around naturally asynchronous I/O.
- Run independent work concurrently only when its dependencies support concurrent use.
  DbContext is not thread-safe: never run parallel queries on the same instance.
- Dispose owned resources with `using` or `await using`; let the container dispose services it owns.
- Bound retries to transient failures and the request deadline. Retrying a write requires an
  idempotency strategy; do not retry validation failures.

## Persistence and API contracts

- Project only needed columns and use AsNoTracking for EF Core reads that will not be updated.
  Check generated SQL for N+1 queries and unbounded results before adding caches.
- Parameterize SQL. Use a transaction when multiple writes must succeed together and handle
  optimistic concurrency explicitly when competing updates are possible.
- Validate public inputs and enforce authorization at the endpoint/service boundary.
- Translate typed domain errors or the existing Result type at one boundary into the established
  HTTP contract, such as ProblemDetails. Keep stack traces and database details out of responses;
  follow `error-contracts` for stable codes.
- Load configuration through the project's existing options/settings mechanism. Never inspect
  `.env` or `appsettings.json`; use safe examples, code declarations, or user-provided values.

## Verification

Run `dotnet build` and the relevant `dotnet test` scope. For an API change, exercise the real
request pipeline with the existing integration harness (for example WebApplicationFactory),
including invalid input, denied access, and error serialization. Test persistence behavior against
a representative database when transactions, SQL translation, or concurrency matter.
