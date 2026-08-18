---
name: nextjs
description: Next.js 16.3 App Router patterns for server and client components, data fetching, caching,
  server actions, streaming, and routes. Use when a repository has next.config or app/. Do not use
  for framework-agnostic React patterns or TypeScript types; use react or typescript respectively.
---

# nextjs

Target **Next.js 16.3** when creating new App Router code. If the repository pins another version,
follow its installed APIs and configuration instead of assuming 16.3 behavior.

Framework-specific rules. Hooks, derived state and keys live in `react`.

**Every component is a server component unless it contains `"use client"`.** That directive is a
**boundary**, not a label: everything imported below it becomes client code. A `"use client"` high
in the tree moves the whole application into the browser and inflates the bundle.

Push the boundary down. If a component needs `useState` for one button, extract **the button**.

## Server or client

| Requirement | Location |
|---|---|
| Read databases, secrets or the filesystem | Server |
| `useState`, `useEffect`, DOM events | Client |
| Browser APIs (`window`, `localStorage`) | Client |
| A heavy library needed only while rendering | Server |

A server component can render a client component. The reverse is not directly possible — a client
component can only receive a server component as `children` or another prop.

**Never import code containing secrets into a client component.** An API key in a browser bundle is
public. Add `import "server-only"` to such modules so compilation fails before production.

## Data

- Fetch **where it is used**, not at the root passed through many layers; request deduplication
  prevents repeated calls.
- Independent requests in parallel with `Promise.all`; sequential `await` adds latency for nothing.
- An `await` in a layout blocks every child page.
- `loading.tsx` and `<Suspense>` stream slow content without blocking fast content.
- `error.tsx` per segment (must be a client component); `not-found.tsx` for missing data.

## Request-time APIs

In Next.js 16.3, request-time values are asynchronous. `params` and `searchParams` are promises in
pages, layouts, routes, and the metadata/image APIs; await them before reading properties. Run
`next typegen` and use its `PageProps`, `LayoutProps`, and `RouteContext` helpers when TypeScript is
enabled:

```tsx
export default async function Page(props: PageProps<'/blog/[slug]'>) {
  const { slug } = await props.params;
  const query = await props.searchParams;
  return <Article slug={slug} query={query.q} />;
}
```

## Caching

### Cache Components in Next.js 16.3

Enable `cacheComponents` deliberately when using the current cache model. Use `use cache`,
`cacheLife`, and `cacheTag` close to the data they govern. Keep `cookies()` and `headers()` out of
cached scopes, or pass their resolved values as arguments.

For mutations, use `updateTag` inside a Server Action when the caller needs read-your-writes,
`revalidateTag(tag, profile)` for stale-while-revalidate content, and `refresh()` when only the
client router needs a refresh. In the legacy fetch model, use `cache: "no-store"` for fresh data and
`next.revalidate` for interval data; inspect the project's config before mixing both models.

The most confusing part, and it fails silently. **Decide explicitly** — a fetch whose cache
behavior nobody chose will eventually return stale data, or none, depending on the version.

- Changing data: say so with `cache: "no-store"` or the version's equivalent.
- Data that changes on an interval: time-based revalidation.
- **After a mutation, invalidate by path or tag.** Otherwise users save and keep seeing old data —
  the most frequently reported failure in this architecture.
- Verify in a **production build**; development caching behaves differently and misleads.

## Server actions

```tsx
"use server";

export async function updateProfile(formData: FormData) {
  const parsed = ProfileSchema.parse(Object.fromEntries(formData));  // ALWAYS validate
  await db.profile.update(parsed);
  revalidatePath("/profile");
}
```

A server action **is a public endpoint** — anyone can invoke it with any payload:

- Validate input with a schema, without exception.
- Check authentication and authorization **inside** the action. A hidden button protects nothing.
- Invalidate afterwards or the UI stays stale.

## Routes and metadata

- Routes follow the directory structure: `app/blog/[slug]/page.tsx`.
- Groups like `(marketing)` organize without changing the URL.
- `generateMetadata` for dynamic titles and Open Graph data; its request-time `params` are async.
- Next.js 16 uses `proxy.ts` instead of `middleware.ts` for the Node.js request boundary. Proxy is
  for quick rewrites/redirects, not slow data fetching or the complete authorization layer.
- `next/image` and `next/font` prevent layout shifts and extra font requests. Prefer
  `images.remotePatterns` over deprecated `images.domains`; use `preload` instead of deprecated
  `priority`, and allowlist local query strings with `images.localPatterns`.

## Anti-patterns

- `"use client"` in the root layout, eliminating server rendering.
- `useEffect` for data the server could fetch.
- Secrets in `NEXT_PUBLIC_*` — that prefix means "send this to the browser".
- A server action without validation or authorization.
- Mutating without invalidating.
- Reading `params` or `searchParams` synchronously.
- Adding new `middleware.ts` when `proxy.ts` is sufficient.
- Measuring performance in `next dev`.
- Relying on the removed `next build` "First Load JS" summary as a performance measurement.
- A large client component where half a line needed interactivity.

## Verification

- `next build` with no errors or new warnings.
- Run `next typegen` and fix async request API type errors.
- Remember that Turbopack is the default for `next dev` and `next build` in Next.js 16; use real
  browser measurements or bundle tooling rather than the old "First Load JS" summary.
- Test the full mutation flow: save, then verify the displayed result is current.
- Invoke a server action with invalid data and verify rejection.
