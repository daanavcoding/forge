---
name: html-css
description: Semantic HTML, accessibility, and modern CSS, including landmarks, forms, focus,
  contrast, flexbox/grid, custom properties, and responsive design. Use when writing markup or
  styles, or fixing accessibility. Do not use for framework-specific patterns; use angular or
  react as appropriate.
---

# html-css

The platform provides much of what gets needlessly reimplemented in JavaScript. The correct element
brings behavior, accessibility and focus handling with no extra code.

**Use the correct element before a div with ARIA.** A `<button>` is already focusable, responds to
Enter and Space, is announced as a button and joins keyboard navigation. A
`<div role="button" tabindex="0">` with three handlers is an inferior reimplementation.

## Semantics

- Landmarks: `<header>`, `<nav>`, one `<main>`, `<aside>`, `<footer>`. They are the index a screen
  reader navigates by.
- Headings in order, no skipped levels, one `<h1>` per page. Level by structure, not font size —
  styling belongs in CSS.
- `<ul>`/`<ol>` for lists so assistive tech announces the item count.
- `<table>` for tabular data with `<th scope>`. Never for layout.
- `<a>` navigates, `<button>` acts. A link with `href="#"` running JavaScript breaks
  open-in-new-tab and misleads anyone who hears it announced as a link.

## Forms

- Every control has an associated `<label for>`. A `placeholder` is **not** a label: it disappears
  on input and many screen readers ignore it.
- Correct `type` (`email`, `tel`, `number`, `date`, `search`) selects the right mobile keyboard and
  gives native validation.
- Prefer `<input type="date">`, `<details>` and `<dialog>` to a library — native, accessible, no
  package cost.
- Associate errors with fields via `aria-describedby` and `aria-invalid`. A detached red message
  may never be announced.
- Group related controls in `<fieldset>` with `<legend>`, especially radio groups.

## Accessibility

- **Contrast:** 4.5:1 normal text, 3:1 large text. Verify with a tool, not by eye.
- **Focus must be visible.** Never `outline: none` without a replacement. `:focus-visible` shows it
  for keyboard users without ringing mouse clicks.
- **Focus order must match DOM order.** Reordering flex or grid items with `order` silently breaks
  keyboard navigation.
- `alt` descriptive when the image conveys information, `alt=""` when decorative. Omitting it makes
  screen readers announce the filename.
- ARIA only when no native element exists. Incorrect ARIA is worse than none.
- Respect `prefers-reduced-motion`; animation makes some users physically ill.

## CSS

- **Custom properties** for themes — `:root { --color-error: #b3261e; --space-2: 0.5rem; }`. A color
  hardcoded in 40 places is 40 places to edit.
- **Flexbox** for one dimension, **grid** for two. Never `float` for layout.
- `gap` for spacing instead of margins that collapse surprisingly.
- Relative units (`rem`, `em`, `ch`, `%`) for anything that should scale with the user's text
  preference; `px` only for borders and fine detail.
- **Container queries** when a component should respond to its container rather than the viewport —
  usually what a media query was trying to say.
- `clamp()` for fluid typography without media queries.
- No `!important` except to override third-party styles you do not control, with a comment saying
  so.

## Responsive design

- Mobile-first: base case, then `min-width` rules. Starting from desktop forces later rules to undo
  earlier ones.
- `max-width: 100%` on images, plus `width`/`height` on `<img>` to reserve space and avoid layout
  shift while loading.
- Wide content (tables, code blocks) scrolls **inside its container**. The page body must never
  scroll horizontally.

## Anti-patterns

- A `<div>` with `onclick` instead of a `<button>`.
- `outline: none` without a visible replacement.
- `placeholder` as a label.
- Text over an image without verified contrast.
- Fixed `px` heights on content that can grow.
- Positive `tabindex`, which breaks natural focus order across the page.
- `display: none` on content screen readers still need — use a visually hidden but accessible class.

## Verification

- Navigate **using only the keyboard**: Tab, Shift+Tab, Enter, Space, Escape. Anything unreachable
  or any disappearing focus indicator is a bug.
- Verify contrast with a tool.
- Zoom to 200%: nothing disappears, no horizontal page scrolling.
- Run axe or Lighthouse with no new violations — remembering automation finds only about a third of
  accessibility problems. Check the rest manually.
