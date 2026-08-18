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

FastAPI + **Pydantic v2** + **SQLAlchemy 2.0 async** + `asyncio`. Never a synchronous route that
blocks.

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
HTTP, the route catches nothing. No `try/except` in the endpoint, no second `AppException`
wrapping the first — the domain error already carries its code and status.

```python
class DomainError(Exception):
    code: str = "DOMAIN_ERROR"
    status_code: int = 400


class EmailAlreadyExistsError(DomainError):
    code = "EMAIL_TAKEN"
    status_code = 409


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": str(exc)})
```

The service checks its invariant and raises (`raise EmailAlreadyExistsError(data.email)`); the
route just declares `response_model` and `status_code` and returns the service call.

## Hard rules

- Route = HTTP only (status, parsing, auth, serialization). Service = business logic.
  Repository = data.
- Only the `exception_handler` translates errors to HTTP. If an endpoint needs `try/except`, a
  handler is missing.
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
