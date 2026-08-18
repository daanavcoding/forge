---
name: java
description: Modern Java 25+ using records, sealed types, Optional, streams, try-with-resources,
  concurrency, and Maven/Gradle project structure. Use when writing or modifying .java files. Do
  not use for cross-layer error contract design; use error-contracts for that concern.
---

# java

Target **Java 25**, the current LTS release, for new code unless the project pins another version.
Modern Java differs substantially from Java in 2010; do not introduce Java 21+ syntax into a
project whose compiler target is still 17.

**Default immutability eliminates whole categories of bugs.** `final` fields, `record` for data,
immutable collections at return boundaries. An object that cannot change cannot be corrupted
between threads or modified unexpectedly by another caller.

## Data: `record`

```java
public record Invoice(String id, BigDecimal amount, Instant issuedAt) {
    public Invoice {                                  // compact constructor = validation point
        Objects.requireNonNull(id);
        if (amount.signum() < 0) throw new IllegalArgumentException("negative amount");
    }
}
```

An invalid `record` can then never exist. It replaces hand-written getters, `equals`, `hashCode`
and `toString`, which were often implemented incorrectly.

## Hierarchies: `sealed`

`sealed interface` + `record` gives compiler-checked closed unions:

```java
sealed interface Result<T> permits Ok, Err {}
record Ok<T>(T value) implements Result<T> {}
record Err<T>(String message) implements Result<T> {}

return switch (r) {                    // no default: the compiler requires every case
    case Ok(var invoice) -> invoice.id();
    case Err(var message) -> "error: " + message;
};
```

Adding a variant and forgetting a `switch` becomes a compilation error, not a production bug.

## `null` and `Optional`

- `Optional` as a **return type** when absence is a normal result.
- **Never** as a field or parameter — not serializable, and as a parameter an overload suffices.
- **Never** return `null` instead of an empty collection; `List.of()` needs no defensive check.
- `optional.get()` without checking is `null` with extra steps. Use `orElseThrow`, `map`,
  `ifPresent`.

## Resources and exceptions

- try-with-resources for every `Closeable`. Hand-written `finally` is forgotten or swallows the
  original exception.
- A custom exception per case a caller must distinguish; otherwise do not wrap.
- **Never** empty `catch (Exception e) {}` or `e.printStackTrace()`. Use the logger.
- Preserve the cause when wrapping: `throw new AppException("...", e)`.
- Do not catch `Throwable` — it swallows `OutOfMemoryError`, after which nothing can be trusted.

## Streams

Streams transform collections; they do not replace every loop.

- A stream with side effects is an inferior `for` loop. Use `for`.
- No `parallelStream()` without measurement — usually slower, sometimes incorrect.
- Extract chains beyond three or four operations into a named method.

## Concurrency

- `ExecutorService` over manually created threads; on Java 21+, virtual threads for I/O-heavy work.
- Shared mutable state requires synchronization; the cheapest synchronization is not sharing it.
- `ConcurrentHashMap` over manually synchronizing `HashMap`.
- A `CompletableFuture` without `exceptionally` or `handle` silently loses failures.

## Anti-patterns

- Hand-written data classes where a `record` fits.
- Returning `null` instead of an empty collection or `Optional`.
- Catching an exception only to log and rethrow it unchanged.
- Habitual setters on objects nobody should mutate.
- Mutable static fields — global state renamed.
- All-static utility classes as a substitute for design.
- `SimpleDateFormat`, not thread-safe; use `java.time`.
- Concatenated SQL. Always parameterized `PreparedStatement`.

## Verification

- Actually run `mvn test` or `gradle test` and retain the output.
- Compile with no new warnings.
- If concurrency changed, add a test that exercises the concurrent path — a sequential test proves
  nothing about concurrency.
- Confirm try-with-resources around each resource opening.
