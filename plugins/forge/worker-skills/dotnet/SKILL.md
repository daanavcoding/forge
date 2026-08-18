---
name: dotnet
description: Modern .NET 10 and C# 14 with Clean Architecture, including layer dependencies, Enumeration
  instead of enum, manual composition without a DI container, and contracts without business
  logic. Use when creating or modifying .NET backends, use cases, interactors, or C# domain
  layers. Do not use for unrelated languages or frontend work.
---

# .NET

.NET 10 is the current LTS baseline and C# 14 is its current language version. Use those features
for new code when the project targets them; preserve an older target's compatibility when it does
not.

.NET backends using Clean Architecture. The cross-boundary error contract is generalized in
`error-contracts`; this skill covers only its C# representation. Testing philosophy lives in
`testing`; the command here is `dotnet test`.

## Layer matrix (the single source of truth)

```
BusinessLogic      -> Types, Types.Exceptions                (nothing else)
ApplicationLogic   -> BusinessLogic, Types, Types.Exceptions
InterfaceAdapters  -> Types, Frameworks.Types
Frameworks         -> Frameworks.Types + external NuGet packages
Contracts          -> no references to another project
```

Never implement a dependency that crosses this matrix in reverse — `BusinessLogic` referencing
`Frameworks`, for instance — even when the task requests it. **Escalate it as a blocker.**

## Hard rules

1. **Never use `enum`.** Use an `Enumeration` class with named static instances; a C# `enum` cannot
   carry behavior or be validated with the rest of the domain.
2. **Never create static classes or methods**, except extension containers
   (`static class XExtensions`).
3. **No dependency-injection container** beyond the host's minimum. Compose manually in an explicit
   factory (`CompositionRoot`), without attributes or assembly scanning.
4. **An interactor must not call another interactor.** Shared steps move into a domain service used
   by both.
5. Classes `internal` by default; `public` only for types intentionally crossing assembly
   boundaries.
6. Methods `private` by default.
7. A parameter with more than one responsibility takes an interface, not a coupled concrete class.
8. `Contracts` references no other project — it is the flat outer boundary.
9. External NuGet packages only in `Frameworks` or the entry point, never in `BusinessLogic`.

## Pattern: one use case, one `Handle()`

A `public interface I{System}{Name}Interactor` exposing `Task<TResult> Handle(TRequest request)`,
implemented by an `internal sealed` class that takes its repositories through the constructor,
checks the invariant, throws the typed domain exception on violation, and returns a result record.

## Enumeration instead of enum

```csharp
public abstract class Enumeration : IEquatable<Enumeration>
{
    public int Id { get; }
    public string Name { get; }

    protected Enumeration(int id, string name) => (Id, Name) = (id, name);

    public bool Equals(Enumeration? other) => other is not null && other.Id == Id;
    public override bool Equals(object? obj) => Equals(obj as Enumeration);
    public override int GetHashCode() => Id.GetHashCode();
}

public sealed class OrderStatus : Enumeration
{
    public static readonly OrderStatus Pending = new(1, nameof(Pending));
    public static readonly OrderStatus Shipped = new(2, nameof(Shipped));

    private OrderStatus(int id, string name) : base(id, name) { }
}
```

## Naming

Interactor interface `I{System}{Name}` (`IUserRegistrationInteractor`). `PascalCase` classes,
`_camelCase` private fields, `camelCase` parameters and variables. One file per public type.

## Validation before handoff

- `dotnet build` with no new warnings.
- `dotnet test` passing for the task's scope.
- No project reference crossing the layer matrix in reverse.
- No new `enum`, static class or method, or DI container.

## Escalate as a blocker

- The task requires a dependency that breaks the layer matrix.
- Completing it requires one interactor to call another.
- Required contracts or interfaces are missing, so no implementation can satisfy the hard rules.

## Anti-patterns

- A C# `enum` in new domain code.
- An interactor invoking another interactor.
- A DI container for new domain code.
- A `public` class that could be `internal`.
- A NuGet package imported into `BusinessLogic`.
