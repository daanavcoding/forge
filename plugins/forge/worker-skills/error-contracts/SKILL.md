---
name: error-contracts
description: Define errors that cross layer or service boundaries using typed domain errors, one
  translation point, and stable consumer-facing codes. Use when designing how errors propagate,
  translate, or surface across layers, services, HTTP clients, or UIs. Do not use for FastAPI's
  concrete handler pattern; use fastapi for that implementation.
---

# Error contracts across boundaries

One rule for every stack: **the domain core raises its own typed error, and translation to the
external form (HTTP, UI message, exit code, event) happens in exactly one place at the layer
boundary** — never scattered across callers.

## Domain error shape

Three fields, in every language: a catchable **type** rather than a string to parse, a stable
**code** that survives message rewording, and a human-readable **message**. Code consumes the code
(tests, clients, logs); people consume the message.

```python
class DomainError(Exception):        # concrete FastAPI/Python implementation lives in `fastapi`
    code: str = "DOMAIN_ERROR"
```

```csharp
public class EmailAlreadyExistsException : DomainException   // full layer matrix in `dotnet`
{
    public override string Code => "EMAIL_TAKEN";
}
```

## One translation point

- **FastAPI:** a global `exception_handler`; see `fastapi`.
- **.NET:** the `InterfaceAdapters`/`Frameworks` boundary (middleware or filter) maps the domain
  exception to `ProblemDetails` or an HTTP status. `BusinessLogic`/`ApplicationLogic` never know
  about HTTP; see the matrix in `dotnet`.
- **Angular:** an `HttpInterceptor`, or the service's `catchError` when there is no global
  interceptor. The component never wraps the HTTP call in `try/catch`; see `angular`.

If you catch and rethrow the same error type in two places within one layer, the single translation
point is missing. Do not add a third — fix the second.

## What must not cross the boundary

- A stack trace or infrastructure message from a DB driver or HTTP client must never reach the
  consumer unchanged. Wrap it in a domain error before it leaves its layer.
- The domain does not choose an HTTP status. It decides *what happened* (`EMAIL_TAKEN`,
  `NOT_FOUND`); the boundary picks the matching transport status.

## Across services, not only layers

When the error crosses into another service via queue, event or internal HTTP call, put the stable
code in the payload (`{"code": "EMAIL_TAKEN", "message": "..."}`). Never only the message text or
the transport status — an HTTP status disappears in a queue, the `code` does not.

## Anti-patterns

- Detecting an error with `if "email" in str(exc)` instead of its type or `code`.
- Translating the same error type differently in several places within one layer.
- Letting a SQL or HTTP-client exception reach the outer boundary unwrapped.
- Choosing an HTTP status in the domain instead of at the boundary.
