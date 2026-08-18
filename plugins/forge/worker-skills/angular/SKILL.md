---
name: angular
description: Angular 22 standalone components with signals, input()/output(), @if/@for control flow with
  track, inject(), OnPush, typed Reactive Forms, and takeUntilDestroyed. Use when creating or
  modifying Angular components, services, guards, interceptors, or forms. Do not use for
  framework-agnostic TypeScript or React work.
---

# Angular

Target **Angular 22** for new code. Components are standalone by default; preserve the repository's
target when working in an older application.

Rules for **new** Angular code. Testing philosophy and coverage live in `testing`; the
frontend/backend error contract lives in `error-contracts` — this skill covers only how Angular
consumes it.

## One position (non-negotiable)

Standalone + signals + `input()`/`output()`/`model()` + `inject()` + native control flow +
`OnPush`. There is no second acceptable position using `@Input`, constructor injection or
`BehaviorSubject` for new code.

**Legacy repositories:** if the file you touch already uses `NgModule`, `@Input()` or
`BehaviorSubject`, do not migrate it unless the task requires that migration. New code you add
still follows this skill even when it differs from the surrounding code. Migrating a whole file
incidentally is out of scope.

## Standard component

```ts
@Component({
  selector: 'app-user-card',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-card.component.html',
  styleUrl: './user-card.component.scss',
})
export class UserCardComponent {
  user = input.required<User>();
  highlighted = input(false);
  selected = output<User>();
  protected readonly fullName = computed(() => `${this.user().firstName} ${this.user().lastName}`);
}
```

## State and injection

Angular 22's `resource` is stable for cancellable asynchronous reads. Use it for signal-driven
loading state when it fits; keep mutations in an explicit service or action, not in a resource
loader.

- Signals (`signal`, `computed`, `linkedSignal`; `effect` only for side effects) are the default
  state mechanism. RxJS only for genuine streams — HTTP, WebSockets, events — converted with
  `toSignal()` when the consumer is the UI.
- `inject()` instead of constructor injection: `private readonly x = inject(X);`.
- Persistent subscriptions use `takeUntilDestroyed(destroyRef)` with
  `destroyRef = inject(DestroyRef)`; single values use `take(1)`. Never `Subject` + `takeUntil` +
  `ngOnDestroy`.

## Control flow and templates

Native `@if` / `@for` / `@switch`, never `*ngIf`/`*ngFor`/`*ngSwitch`. **Every `@for` must include
`track`**, and `@empty` handles the empty case:

```html
@for (item of items(); track item.id) {
  <li>{{ item.name }}</li>
} @empty {
  <li>No results</li>
}
```

## Typed reactive forms

```ts
private readonly fb = inject(NonNullableFormBuilder);

readonly form = this.fb.group({
  email: this.fb.control('', { validators: [Validators.required, Validators.email] }),
  amount: this.fb.control<number | null>(null, { validators: [Validators.min(0)] }),
});

submit(): void {
  this.form.markAllAsTouched();
  if (this.form.invalid) return;
  const payload = this.form.getRawValue();
}
```

Never template-driven forms or `FormControl<any>` in new code.

## HTTP in services

Never `HttpClient` in a component. A `@Injectable({ providedIn: 'root' })` service injects it and
returns the typed `Observable`; the service handles network errors at the boundary. The shape of
the error crossing into the UI is defined in `error-contracts`.

## Types and naming

- `strict: true` in `tsconfig.json`. Never `any`; use `unknown` when the type is unknown. This
  TypeScript rule is shared with `react`.
- Component `kebab-case.component.ts`, selector `app-kebab-case`. Service
  `kebab-case.service.ts`. Domain interface `PascalCase.ts`, no `I` prefix.

## Tests

New Angular CLI projects use Vitest with `jsdom`; run `ng test` (use `--no-watch` in CI). Keep
Karma/Jasmine or Jest only when the repository already uses it or a browser-specific test requires
it.

## Anti-patterns

- `@Input()`/`@Output()`/`EventEmitter` or `NgModule` in new code.
- `*ngIf`/`*ngFor` in new templates.
- `HttpClient` injected directly into a component.
- `any` in the diff.
- `Subject` + `takeUntil` + `ngOnDestroy` instead of `takeUntilDestroyed`.
