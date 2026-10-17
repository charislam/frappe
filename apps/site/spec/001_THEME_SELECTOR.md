# Theme selector implementation plan

Status: requirements agreed; implementation pending.

## Agreed behaviour

- Provide a native select labelled “Theme” with Light, Dark, System in that order. Keep it visible in the global header at desktop and mobile widths, outside collapsible navigation.
- Default to System when no valid preference exists. System follows `prefers-color-scheme: dark` immediately, including changes while the page is open. Explicit Light/Dark overrides OS changes.
- Persist the preference across browser sessions, independently of authentication, and synchronize other tabs on the same origin.
- Toggle only the `dark` class on `body`, preserving other classes. Its presence means the resolved theme is dark; absence means light. The select continues to show System when System resolves to dark.
- Prevent an incorrect-theme flash on initial load and reload, including saved overrides that disagree with the OS. An after-mount correction is insufficient.
- Storage failures must not break startup or selection. Apply changes for the current session, log a diagnostic, and show no storage error UI.
- Preserve the light palette and introduce charcoal surfaces with green accents for dark mode. Ensure readable text, selected states, controls, and focus indicators.
- Standardize existing and new persistence on the current app-local storage resource, backed by Effect storage. Preserve existing account-demo data and keys.

## Repository findings

- `src/local-storage.ts` provides `LocalStorage`, `LocalStorageLive`, and `LocalStorageMemory` using a custom `Resource.Service`. Its production consumer is `src/account.ts`; bootstrap and resource/app tests supply its layers.
- The pinned Effect version is `4.0.0-rc.115`. The requested KeyValueStorage functionality is actually named `KeyValueStore`, imported from `effect/unstable/persistence/KeyValueStore`. It exposes `layerStorage`, `layerMemory`, optional reads, and typed operation errors. Use the installed source as authority; vendored reference source lives under `repos/effect`.
- `layerStorage(() => window.localStorage)` evaluates the storage getter during layer construction. That getter can throw before the typed operation handlers run; protect acquisition explicitly.
- `src/main.ts` starts a deferred module entry. Resolving the initial theme there alone cannot guarantee no flash.
- `src/style.css` already contains most colour tokens, but two selected-navigation backgrounds use `#d1fae5`, routing controls use a literal `white` fallback, and the card shadow embeds a colour. Primary buttons and selected tabs reuse the surface token for foreground, which needs its own semantic role.
- Root text/background currently resolve tokens on `:root`. Body overrides alone cannot change values already computed on the root.

## Module boundaries

Keep all theme-specific modules and their colocated tests under `src/features/theme/`.

1. `src/features/theme/model.ts`: preference schema/type (`light | dark | system`), resolved theme, storage key (`frappe.theme`), validation/defaulting, and pure resolution. Store the plain preference string; unknown or malformed strings resolve to System without destructive cleanup.
2. `src/local-storage.ts`: retain the app's single resource and named-object write interface. Implement browser and memory layers through Effect `KeyValueStore`; remove direct storage operations and the hand-written memory map. Keep storage errors explicit at the adapter boundary and recover where a consumer has a meaningful fallback. Acquire memory independently for each runtime.
3. `src/features/theme/browser.ts`: injectable browser boundary for media-query observation, storage events, and class projection. Own listener disposal through the application scope; no listeners or DOM mutations during module import.
4. `src/features/theme/controller.ts`: app-lifetime preference/effective-theme state and serialized updates. Own storage policy, resolution, and synchronization; expose a read-only preference signal and a named selection operation to the UI. Use the existing Frappe resource/context conventions rather than a module-global mutable singleton.
5. `src/features/theme/selector.ts`: labelled native control, options, signal binding, and selection events. No storage calls or media-query handling in the component.
6. `src/features/theme/initialize.ts`: minimal synchronous initialization built from the shared model and storage adapter. Establish the initial theme before visible content can paint, then hand the validated preference to the main application without an intermediate default render.
7. `src/bootstrap.ts`, `src/app.ts`, `index.html`, and `vite.config.ts`: lifecycle, header placement, and early-script build integration only. Keep feature logic in the theme modules.

Use `Option` for absent values, exhaustive `Match.value` for branching, top-level imports, named options objects, and named Effect operations. Do not add parallel localStorage implementations or dependencies on vendored source.

## Implementation sequence

### 1. Standardize persistence

- Adapt `LocalStorageLive` to `KeyValueStore.layerStorage` and `LocalStorageMemory` to `KeyValueStore.layerMemory`.
- Guard access to the browser storage getter with a typed Effect boundary before supplying the layer. Support a memory fallback when browser storage cannot be acquired; report the failure once without leaking stored values.
- Maintain existing `demo-email` key and string encoding. Update Account's failure handling so a failed read uses its existing default email and a failed save does not undo successful sign-in.
- Keep consumer-friendly `{ key, value }` writes; the upstream two-string method is confined to the adapter.
- Keep failed theme writes in controller memory so later rendering never reverts a selection because persistence failed. Serialize writes to avoid an older rapid selection overwriting a newer one.

### 2. Establish no-flash initialization

- Produce a small classic, synchronous bundle for the initializer and inject it as a parser-blocking script at the start of `body`, before app content. It must not be async, deferred, or a module script. Keep theme CSS available through a stylesheet in the document head so script and styles settle before the content is painted.
- Use the same Effect-backed storage adapter and pure model as the runtime; do not hand-copy decoding or bypass Effect with an inline raw storage read. Keep this path synchronous and independent of application mounting, authentication, and queries.
- Supply equivalent HTML transformation in Vite development and production builds. Inspect emitted HTML to confirm ordering and ensure the initializer is bundled without runtime module imports. Measure its size; avoid pulling the full application into this bundle.
- Resolve saved preference, recover storage failure to System, read the current media query, and set `body.dark` before content. Publish only the validated startup snapshot through a narrow, typed handoff that the app consumes. No long-lived listeners belong to the early initializer.
- On runtime acquisition, install scoped listeners and reconcile the latest OS and persisted preference to cover changes between early initialization and mount. Preserve session state if persistence is unavailable. Do not reset the body class while mounting.
- Verify browser canvas/background painting as well as content; hiding content until mount is not sufficient. Root canvas styling must derive from the body class as described below. Validate the first painted frame under throttling before considering this step complete.

### 3. Implement state and synchronization

- Initialize the controller from the early snapshot; maintain preference separately from effective theme.
- Apply user selection immediately to the signal/body class, then persist it. On failure retain the new selection for this session and log a diagnostic.
- Listen for media-query changes. Recompute only the effective theme; never overwrite the stored preference with the OS result.
- Process storage events only from local storage and only for `frappe.theme` or a storage-clear event. Decode the incoming value; removal, clear, and invalid values mean System. Ignore unrelated keys and session storage.
- Remote changes update the select and theme without writing back, avoiding event loops. The latest processed local or remote preference wins; serialize local writes and state events consistently.
- Dispose media-query/storage listeners and signal subscriptions on unmount or HMR interruption. Ensure remounting creates exactly one active controller. Preserve unrelated body classes throughout.

### 4. Tokenize and style

- Keep all styles in `src/style.css` and preserve cascade layers and specificity caps.
- Define light defaults and dark overrides as semantic custom properties in `base`, using `:where(body.dark)` for dark overrides. Apply body text, background, and `color-scheme` explicitly so controls inherit the resolved theme.
- Address the root canvas explicitly: use a zero-specificity root selector derived from `body.dark` (for example `:where(:root:has(body.dark))`) for the canvas background and root `color-scheme`, with palette values factored into reusable variables. Verify browser support against the app's supported environments during implementation. Do not rely on descendant custom properties propagating upward.
- Add semantic selected-background, on-accent, and shadow-colour tokens. Replace both literal selected-navigation backgrounds, remove the white fallback, and compose shadows from their colour token. Check foreground contrast separately from surface colour.
- Audit the site's CSS, inline attributes/styles, and rendered shared UI for all colour literals and browser-default states that need explicit theming. Colour literals belong only in token definitions; `inherit`/`currentColor` may derive from token-controlled ancestors.
- Style the select in the native layer, and its header placement in the UI layer. Keep its visible label, keyboard behaviour, focus indication, and mobile width usable. Avoid adding full-page theme animation.

### 5. Integrate the selector

- Mount once in the global header outside the mobile navigation's show/hide container.
- Associate the visible Theme label with the select using the existing occurrence-ID pattern.
- Bind preference changes in both directions, including remote-tab updates. All routes, including not-found pages, retain the global preference and selector.

## Validation and acceptance

- Pure tests: all preference/OS combinations, absent and invalid storage values, explicit preference immunity to OS changes.
- Storage tests: browser getter failure, read/write failures, preserved `demo-email`, and independent memory layers across runtimes.
- Controller/UI tests: initial selection, immediate updates, System tracking, two-tab event simulation, removal/clear, unrelated-event filtering, no write-back loops, rapid changes, failed-save retention, and scoped cleanup/remount behaviour.
- Bootstrap tests: initializer handoff, unavailable storage, and interruption without duplicate listeners; retain the existing missing-root diagnostic.
- Run `pnpm fmt`, `pnpm lint`, `pnpm typecheck`, site tests, and the site production build. Investigate failures and distinguish pre-existing failures from regressions. Verify production HTML initializer ordering after the build.

## Scope

Deliver the theme selector, complete site colour tokenization/dark palette, and migration of existing app storage consumers to the shared Effect-backed adapter. No account/server preference synchronization or broader component redesign is required. This document is the plan only; no application implementation is included in this change.
