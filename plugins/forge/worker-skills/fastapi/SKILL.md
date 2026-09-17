---
name: fastapi
description: FastAPI 0.137+ patterns for Pydantic 2.12 contracts, router/service/repository layers,
  typed errors, and asynchronous SQLAlchemy 2.0. Use when creating or modifying FastAPI endpoints,
  schemas, or services. Do not use for framework-agnostic Python rules; use python instead.
---

# FastAPI

Target current FastAPI 0.137+ with Pydantic 2.12+ and SQLAlchemy 2.0. If the repository pins an
older compatible release, follow its lockfile and migration path.

FastAPI-specific rules. Typing, logging, layering and dependency rules for all Python live in
`python`.

## Stack

Use the installed Pydantic and persistence stack. `async def` routes require nonblocking I/O;
regular `def` routes can use blocking libraries through FastAPI's thread pool. Do not add
SQLAlchemy or migrate a synchronous stack unless persistence work requires it.

## Structure

```
src/
├── main.py            # app = FastAPI()
├── routes/            # APIRouter, one per resource
├── schemas/           # Pydantic request/response models
├── services/          # business logic
├── repositories/      # data access
├── models/            # SQLAlchemy ORM models
└── dependencies.py    # Depends() factories
```

`route -> service -> repository` by default, unless the repository already has equivalent clean
layering. Do not invent another layer when one exists.

## Input and output contracts

Pydantic for every public contract; never an untyped dict as `response_model` or payload. Response
models that are built from ORM objects need `model_config = ConfigDict(from_attributes=True)`.
Use `EmailStr` and the other constrained types instead of bare `str` where a format is required.

## Persistence: SQLAlchemy 2.0 async

The 2.0 async API is `session.execute(select(...))`, **not** `db.query(...).filter(...)` — that is
the synchronous 1.x API and has no awaited form:

```python
async def get_by_email(session: AsyncSession, email: str) -> User | None:
    result = await session.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()
```

## Typed errors without leakage

**One mechanism:** the service raises a domain error, a global `exception_handler` translates it to
HTTP. Keep transport status mapping at that boundary, not in domain exceptions. Preserve an
existing consistent error contract rather than introducing a second wrapper.

```python
class DomainError(Exception):
    code: str = "DOMAIN_ERROR"


class EmailAlreadyExistsError(DomainError):
    code = "EMAIL_TAKEN"


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    if isinstance(exc, EmailAlreadyExistsError):
        return JSONResponse(status_code=409, content={
            "code": exc.code, "message": "Email already registered",
        })
    return JSONResponse(status_code=500, content={
        "code": "INTERNAL_ERROR", "message": "Request could not be completed",
    })
```

The service checks its invariant and raises (`raise EmailAlreadyExistsError(data.email)`); the
route just declares `response_model` and `status_code` and returns the service call.

## Hard rules

- Route = HTTP only (status, parsing, auth, serialization). Service = business logic.
  Repository = data.
- Use a consistent boundary handler for domain errors. Local recovery or resource cleanup may
  still require `try/except`; do not expose exception strings or sensitive request values.
- No blocking synchronous I/O inside an `async def` route.
- `Depends()` for sessions, auth and settings — never instantiate them in the route.
- Environment variables through `pydantic_settings.BaseSettings`; never hardcoded.
- Use an application `lifespan` context for startup/shutdown resources in new code; keep legacy
  event handlers only when the existing application already depends on them.
- JSON request clients must send a valid `Content-Type: application/json`; test this boundary rather
  than disabling FastAPI's strict content-type checking without a documented reason.
- After contract changes, keep the OpenAPI schema aligned with actual behavior.

## Anti-patterns

- `db.query(Model).filter(...).first()` — not the async 2.0 API.
- A repository or service raising `HTTPException` directly.
- A public endpoint without `response_model`.
- Changing middleware or authentication without exercising the async path.

## Verification

Use the existing TestClient or async HTTPX setup with isolated dependency overrides. Exercise
valid input, validation failure, unauthenticated/unauthorized access, and domain-error mapping.
For database changes, verify rollback and session cleanup; do not share one AsyncSession across
concurrent tasks. Restore dependency overrides after each test.
