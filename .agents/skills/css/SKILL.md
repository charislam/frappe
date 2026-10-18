---
name: css
description: |
  Guide for authoring CSS in this repo: a single native style.css per app, organized in cascade layers with specificity controlled via :where(). Use when adding or editing styles, components, or page styling.
---

# CSS

Reference implementation: `apps/site/src/style.css`.

We stay close to web-native capabilities: one plain `style.css` per app. No Tailwind, no CSS-in-JS, no preprocessors. Use native nesting, custom properties, `@layer`, `:where()`, logical properties, and `min()`/`calc()`.

## Three primary patterns

### 1. Declare layers once, in order, at the top

```css
@layer base, native, components, scaffold, ui, page;
```

Define each layer in exactly one block in `style.css`. Add rules to that existing block; never append another `@layer page` (or other repeated layer block) at the end of the file.

Every rule lives inside one of these layers. Later layers win over earlier ones regardless of specificity, so never reach for `!important` or higher-specificity selectors to override across layers.

| Layer        | Purpose                                                                                       | Max specificity                                                  |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `base`       | Design tokens as CSS variables on `:root`, resets, root/body-wide styling                     | Zero: wrap everything in `:where()`                              |
| `native`     | Styles for bare HTML elements (`h1`, `p`, `a`, `button`, `input`)                             | A single element selector                                        |
| `components` | Reusable components applied with classes (the same element can belong to different components) | At most a single element selector; may be lower (`:where(.card)`) |
| `scaffold`   | App-shell layout components; conceptually one instance each per app                           | A single class selector                                          |
| `ui`         | Shared app UI such as the global header/menu                                                  | A single class selector                                          |
| `page`       | Per-page overrides                                                                            | A single class selector (the page wrapper)                       |

### 2. Cap specificity per layer, using `:where()` for everything beyond the cap

- `base`: `:where(:root)`, `:where(body)`, `:where(:focus-visible)`.
- `native`: bare element selectors only. Pseudo-classes, states and attribute variants go inside `:where()` so specificity stays at one element: `&:where(:hover:not(:disabled))`, `:where(&:disabled)`, `&:where(:not([type="checkbox"]))`.
- `components`: wrap the class in `:where()`: `:where(.card)`. A variant of an element may use element + `:where(.class)`: `button:where(.primary)` (specificity of one element). Nested descendants also use `:where()`.
- `scaffold` / `ui`: one bare class selector (`.app-shell`, `.app-header`); all nested selectors use `:where()`: `:where(.app-header-title)`, `:where(nav)`, `:where(a[aria-current="page"])`.
- Never chain, never use ids, never nest without `:where()` (nested `a` inside `.x` becomes `.x a`, raising specificity).

### 3. Pages are one nested block under the wrapper class

Each page gets exactly one top-level class selector in the `page` layer (its wrapper container, e.g. `.examples-page`). Everything inside is nested and wrapped in `:where()`, so the whole block is specificity (0,1,0) and any page-local piece is trivially overridable:

```css
@layer page {
  .examples-page {
    padding-block: var(--space-content-block);

    :where(.counter) {
      display: flex;

      :where([data-slot="count"]) {
        font-size: 1.5rem;
      }
    }
  }
}
```

Page-local sub-components (`.counter`, `.todos`, `.routing-controls`) are scoped by nesting. If one is needed on several pages, promote it to the `components` layer.

## Secondary patterns

- **Tokens**: all colors, radii, spacing, shadows and transitions are custom properties defined in `base` on `:where(:root)`, named by role: `--color-*`, `--radius-*`, `--space-*`, `--shadow-*`, `--transition-*`. Reuse tokens (`var(--color-border)`) instead of literals; add a token when a value is reused or semantic. One-off sizes (`0.5rem`, `2rem`) may stay literal.
- **Responsive layout**: use the existing `viewport` container query and inherited `--is-mobile` / `--is-desktop` switches. The breakpoint is defined once in `base`; do not introduce component-specific width media queries or repeat arbitrary breakpoint ranges. Branch property values with `property: var(--is-mobile, <desktop value>) var(--is-desktop, <mobile value>)`. For example, `grid-template-columns: var(--is-mobile, minmax(0, 1.5fr) minmax(0, 1fr)) var(--is-desktop, minmax(0, 1fr))` gives two desktop columns and one mobile column. Keep media queries for independent capabilities and preferences, such as pointer precision and reduced motion.
- **Native nesting**: use `&` for state/variant selectors, and `:where(&:disabled)` when the parent should not be counted. Nest capability/preference queries inside the rule they modify; use the shared switches for responsive layout.
- **State selectors guard disabled**: `:hover:not(:disabled)`; disabled uses `opacity` and `cursor: not-allowed`.
- **Accessibility**: global `:focus-visible` outline in `base`; `@media (prefers-reduced-motion: reduce)` disables transitions; select on ARIA state where it exists (`[aria-current="page"]`, `[role="tab"][aria-selected="true"]`, `p[role="alert"]`) instead of adding state classes.
- **Stable selectors**: keep semantic HTML, but target the intended UI part instead of a tag name or incidental DOM structure. Prefer semantic data attributes such as `[data-slot="field"]`, `[data-slot="hint"]`, and `[data-slot="error"]` for component parts; use ARIA or existing data attributes for state. Use a named class when data attributes do not express the part clearly. Avoid broad page descendants such as `p`, `h3`, or `fieldset p` that accidentally style new content or break when an element or wrapper changes. Keep these targeted selectors inside `:where()` so specificity stays within the layer cap; increase targeting precision rather than selector weight.
- **Logical properties**: prefer `margin-block-end`, `padding-block`, `margin-inline`, `border-block-start`.
- **Layout**: flex with `gap` for spacing between siblings; `width: min(100%, 42rem)` with `margin-inline: auto` for containers; avoid sibling margins when `gap` works.
- **Inherit fonts on controls**: `font: inherit` on buttons and inputs; `accent-color` for checkboxes.
- **Naming**: kebab-case classes; page wrappers end in `-page`; UI/scaffold prefixed `app-`; descendants named by role (`.todo-actions`, `.routing-controls`).
- **Variants stay in the layer of their base**: e.g. `button:where(.primary)` in `components` extends the `button` in `native`.

## Checklist

1. Pick the layer by scope: tokens/reset → `base`; bare element → `native`; reusable class → `components`; app shell → `scaffold`; shared chrome → `ui`; single page → `page`.
2. Insert rules into the existing layer block and target stable UI parts with data attributes or classes.
3. Verify specificity is within the layer's cap; wrap the rest in `:where()`.
4. Use tokens and logical properties; no `!important`, ids, or inline styles.
5. Run `pnpm fmt` and `pnpm lint`.
