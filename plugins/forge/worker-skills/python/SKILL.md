---
name: python
description: Baseline Python 3.14+ rules for scripts, CLIs, libraries, and domain logic, with or
  without a web API. Use when writing or modifying framework-agnostic Python code. Do not use for
  FastAPI-specific endpoints or framework patterns; use fastapi for those concerns.
---

# Python

Target **Python 3.14+** for new code unless the repository declares a lower supported version. Do
not backport 3.14-only syntax or standard-library APIs into an older project without checking its
runtime matrix.

## Typing

- Type hints mandatory on public signatures; add to private ones when they clarify.
- Never return `Any` from a public function. Model shapeless data with `dataclass`, `TypedDict`
  or `Protocol`. An untyped dict must not cross a module boundary.
- `pathlib.Path` for paths, never `os.path`.
- Prefer `@dataclass(frozen=True, slots=True)` for value objects.

## Errors

- Catch concrete exception types. Never `except Exception` around business logic.
- Domain errors are classes callers catch by type, not by parsing messages:

```python
class InvalidEmailError(ValueError):
    def __init__(self, email: str) -> None:
        super().__init__(f"invalid email: {email}")
        self.email = email
```

- Translate an error to its external form (HTTP, exit code, log) **only** at the layer boundary.
  The domain core raises a domain error, never an HTTP code or `sys.exit`.

## Logging

- Never `print()` for errors or diagnostics. Use `logging` in libraries and services; `sys.stderr`
  only in the `main()` of a single-file script where configuring `logging` is disproportionate.
- One `logger = logging.getLogger(__name__)` per module. Never the root logger.

## Layers

- Separate business logic from I/O, CLI, web adapters and persistence. The domain layer imports no
  transport dependency (`fastapi`, `argparse`, a DB driver).
- Thin entry point, substantial testable core. A one-function script is fine; do not force three
  layers without a real domain to separate.
- No mutable module-level state. Inject dependencies through parameters or constructors.

## Dependencies

- Prefer the standard library. Add a dependency only when it solves something more expensive to
  maintain by hand.
- Pin with `==` or a lockfile for deployed software; never an unconstrained `>=` in production.
- `pyproject.toml` for new projects, not `setup.py`.

## Script structure

Module docstring, `from __future__ import annotations`, argparse isolated in `parse_args()`,
`logging.basicConfig` inside `main()`, `def main() -> int` returning distinct exit codes per
failure, and `if __name__ == "__main__": sys.exit(main())`.

## Docstrings and comments

- Write docstrings and comments in English by default, unless the user explicitly requests
  another language.
- Follow PEP 257 and the repository's documentation conventions. Add docstrings to public
  modules, classes, functions, and methods when they clarify purpose, behavior, contracts,
  parameters, return values, or raised exceptions.
- Keep comments concise and use them to explain why, constraints, or non-obvious behavior;
  do not restate code that is already clear. Update or remove comments and docstrings that
  become stale.

## Secrets

Read from `os.environ` or the project's settings library (see `fastapi` when applicable). Never a
literal secret value in source or a commit.

## Anti-patterns

- Untyped dict or `Any` crossing a public module boundary.
- `except Exception` around business logic.
- Mutable global state.
- Circular imports — they mean the layers are wrong.
- A catch-all `utils` module with no coherent responsibility.
