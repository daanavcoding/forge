---
name: react
description: React 19.2 with hooks, derived state instead of synchronization effects, stable
  list keys, error boundaries, and server components when supported by the framework. Use when
  creating or modifying React components, hooks, or state. Do not use for Angular or
  framework-specific Next.js behavior.
---

# React

Target **React 19.2** for new code unless the repository pins another version. Framework-specific
server-component behavior still belongs to the framework skill, such as `nextjs`.

React-specific rules. Strict TypeScript follows the same rule as Angular (see `angular`); testing
philosophy and coverage live in `testing`.

## Derived state, not `useEffect` synchronization

If a value can be calculated from other state or props, calculate it during render. Duplicating it
in a second `useState` synchronized by `useEffect` adds a render and a failure source, because an
effect can run late or not at all.

```tsx
const [fullName, setFullName] = useState('');                    // bad
useEffect(() => setFullName(`${user.firstName} ${user.lastName}`), [user]);

const fullName = `${user.firstName} ${user.lastName}`;           // good: derive during render
```

`useMemo` only for an expensive, *measured* calculation. `useEffect` only for synchronization with
something **outside** React: network, DOM, timers, external subscriptions.

When an Effect needs a callback that sees the latest props/state without becoming a reactive
dependency, use React 19.2's `useEffectEvent`. Do not use it to hide a dependency that should cause
the Effect to re-run, and do not use it for ordinary click handlers.

## Stable keys

Never an array index as `key` when a list can reorder, filter or insert in the middle — React
reuses the wrong node and carries over the previous item's state. Use the domain ID:
`items.map((item) => <Row key={item.id} …/>)`. An index key is acceptable only for a static list
whose order and length never change.

## Error boundaries

Still requires a class; React 19 has no equivalent hook. One per UI section that can fail
independently, not one global boundary.

```tsx
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(): State { return { hasError: true }; }
  componentDidCatch(error: unknown): void { console.error(error); }   // project logger if available
  render(): ReactNode { return this.state.hasError ? this.props.fallback : this.props.children; }
}
```

## Server components

Where the framework supports them (Next.js App Router), components are server components by
default; mark `'use client'` only when using state, effects or browser events. Does not apply to a
SPA without server-component support (Vite + React Router) — everything there runs on the client.

## State and layers

- Prefer local `useState`/`useReducer` to a global state library. Do not introduce Redux, Zustand
  or similar when the repository does not already use it and `useState` plus context solves it.
- In React 19, function components can receive `ref` as a prop; do not add `forwardRef` to new
  components unless compatibility with an older React target requires it.
- Business logic outside the component, in a custom hook (`useX`) or an imported pure function.
  No 300-line component with rules inline.

## Naming

- Component `PascalCase.tsx`, one per file except trivial private subcomponents.
- Custom hook `useName.ts`, always starting with `use`.
- Colocated test `ComponentName.test.tsx`.

## Tests

Vitest + React Testing Library, or Jest when the repository already uses it. Query the DOM by role
or text (`getByRole`, `getByText`), not by CSS class or `data-testid` unless there is no accessible
alternative.

## Anti-patterns

- `useEffect` plus `useState` for a value derivable during render.
- Array index as `key` in a changing list.
- One global error boundary instead of one per independently failing section.
- A global state library for a case `useState` solves.
- Business logic inside JSX instead of a hook or pure function.
