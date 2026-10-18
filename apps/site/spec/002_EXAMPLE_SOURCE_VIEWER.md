# Example pages and source viewer

Status: requirements agreed; implementation pending. This change is a specification only. Do not install dependencies as part of writing this spec.

## Agreed behaviour

- All eight demos belong under Examples: Counter, Text input, Tabs, Auth, Loading, Todos, Routing, and Queries. Account and Auth were consolidated during review: Auth is a demo workspace with an email sign-in form, session restoration, protected Overview/Profile navigation, a personal checklist, per-account profile persistence, and sign-out. Authentication remains provided by the shared demo Auth resource; the example does not claim real server authentication.
- Keep the existing example URLs except `/examples/account`, which was consolidated into `/examples/auth`. Move Routing to `/examples/routing` and Queries to `/examples/queries`. Remove their separate global navigation entries and standalone page branches. No redirects or compatibility routes for `/routing` or `/queries` are required.
- Routing is a Waypoint project workspace with a sample signed-in session, project list, nested overview/settings pages, saved briefs, project following, and session notes. Loading, session, and history simulations remain available under Demo tools.
- Each example subpage shows its working live demo above a read-only source viewer. Preserve existing demo behaviour and resource lifetimes.
- On wide screens, the viewer presents a flat file list on the left and the selected file's syntax-highlighted code on the right. Paths distinguish files; there is no file tree.
- On small screens, show a labelled file selector below the selected code.
- Include line numbers, copy-current-file, horizontal scrolling for long lines, and syntax colours that follow the site's effective light/dark theme. No editor, search, wrapping control, or shareable file-selection URLs are required.
- Use Shiki to highlight during development/build. Do not ship the highlighting engine to the browser.
- Discover source files automatically from each example directory, then follow local imports to include shared supporting modules. Do not maintain handwritten per-example source-file lists or copied source strings.

## Repository findings

- `src/examples.ts` currently combines example registration, navigation, and page composition. The seven demos are top-level modules in `src/`.
- `src/examples-routes.ts` defines the seven example routes and defaults `/examples` to Counter. Preserve that default.
- `src/routes.ts` and `src/app.ts` currently treat Routing and Queries as separate top-level pages.
- Routing already has multiple modules under `src/routing-demo/`. Its inner route definitions include the `/routing` prefix, and the outer app specially handles unmatched descendants of Routing so its inner router can interpret them.
- Queries currently combines its component, query definitions, resources, and session context in `src/query-demo.ts`.
- `src/bootstrap.ts` installs demo resources and query configuration. Account also imports shared auth and storage modules. Moving files must preserve service identity and existing resource configuration.
- The site uses Frappe, Effect, and Vite, with a single `src/style.css`. It has an existing light/dark/system theme implementation.

## Module boundaries

Suggested structure, with descriptive filenames retained where they improve readability:

```text
src/
  examples/
    registry.ts
    page.ts
    routes.ts
    counter/
      example.ts
      example.test.ts
    text-input/
    tabs/
    auth/
    loading/
    todos/
    routing/
      example.ts
      routes.ts
      model.ts
      resources.ts
      ...
    queries/
      example.ts
      queries.ts
      resources.ts
      context.ts
  features/
    code-viewer/
      model.ts
      view.ts
  style.css
tooling/
  example-sources/
    discover.ts
    highlight.ts
    plugin.ts
```

- Each example directory owns its live entry component, example-specific supporting modules, and colocated tests. Split modules by responsibility; small examples need only their entry module.
- Keep the registry and page/viewer infrastructure outside individual example directories so discovery does not include them as example source.
- Registry entries declare route identity, title, and the live entry module/component. Derive directory discovery from that entry, using the same resolvable module identity as the live demo. Do not independently maintain a source-entry path that can silently diverge from the component import. Validate the association during build.
- Generated source metadata joins the registry by stable example identity. Metadata contains file identity, display path, language, original source, and highlighted representation; it does not need to be checked into source control.
- Keep the viewer independent of route names and discovery. It consumes an ordered, nonempty collection of source files and owns selected-file state.
- Keep genuinely shared modules shared. Do not copy storage or auth implementations into example directories just to display them. Do not relocate shared application services merely for the directory layout.
- Follow repository conventions: `Option` for absence, exhaustive `Match.value` where applicable, top-level imports, and named options objects. Keep CSS in the existing stylesheet, cascade layers, and specificity conventions. Do not import or edit vendored repositories.

## Automatic source discovery

### Inclusion and traversal

1. Resolve the example entry module and recursively enumerate eligible source files in its directory. Initially support TypeScript, JavaScript, and JSON; use a centralized extension/language mapping rather than per-example lists.
2. Exclude test/spec files, test fixtures, declaration-only files, generated output, and example-registration metadata through centralized conventions. Keep all runtime example code eligible.
3. Parse static imports and re-exports, including type-only imports and re-exports. Follow relative and site-local alias imports using the site's configured resolution rules. Include statically resolvable literal dynamic imports if encountered; do not execute modules to discover dependencies.
4. Recursively include local dependencies outside the example directory, deduplicating canonical paths and handling import cycles. Traverse imports outward from example source, never reverse dependencies such as the app bootstrap importing a demo.
5. Stop at package imports, including workspace packages such as `@charismaticalli/frappe` and `@charismaticalli/ui`, and at built-in/external/virtual modules. Never expand dependencies into `node_modules`, vendored repositories, or arbitrary filesystem locations. Constrain local source discovery to the site's source root.
6. Report unresolved local imports and unsupported local source dependencies with the importing file and specifier. Fail the build rather than silently present an incomplete source set. Report nonliteral dynamic local dependencies for explicit resolution if introduced; do not guess their targets.

The discovery contract shows implementation and its outgoing local dependencies, not a complete standalone application scaffold. Global styles, application bootstrap, and package internals are not included merely because the demo uses them indirectly at runtime. Shared storage helpers reached through imports are included; reverse consumers of those helpers are not.

### Ordering and updates

- Show the entry file first and all remaining files in deterministic alphabetical display-path order. Default selection is the entry file.
- Display example-local paths relative to the example directory and shared paths relative to the site source root with a clear shared prefix. Keep labels unique; do not expose absolute workstation paths.
- File contents must be the actual source used to build the example, including comments and imports. Do not rewrite imports or maintain instructional copies.
- In development, watch directory additions, edits, moves, and deletions, as well as discovered shared dependencies. Regenerate discovery and highlighting when either content or the graph changes; watching only the initial file list is insufficient.
- If an update removes the selected file, select the entry file. When switching between examples, initialize that example's viewer at its entry file. No persistence or URL state is required.
- Discovery and highlighting run through the same pipeline in development and production. Emit deterministic metadata; build-time code must stay out of browser bundles.

## Highlighting and viewer behaviour

- Use Shiki as a build-time dependency when implementation is authorized. Load only supported languages and the chosen light/dark themes. Exact theme names may be selected during implementation to suit existing site colours.
- Produce both theme variants from the same source and select presentation using the existing effective theme state or CSS class. Theme changes must not refetch files, rerun highlighting in the browser, reset file selection, or remount the demo.
- Render source safely: source characters must remain text, including strings containing HTML or script tags. Use escaped highlighted output or structured tokens; never insert raw source as HTML.
- Preserve source whitespace. Keep code scrolling inside the viewer so long lines do not widen the page. Line numbers are decorative and excluded from copied text.
- Copy uses the original selected-file source. Provide accessible success/failure feedback; clipboard failure must not disrupt the viewer.
- Use a labelled, keyboard-operable file list with visible selected and focus states on desktop, and a labelled native selector below the code on mobile. Keep the selected filename visible alongside the code. Code scrolling must be keyboard accessible.
- Selecting a file updates only the viewer and resets its code scroll position to the start. It must not reset live example state. Match existing page spacing and responsive conventions rather than introducing an unrelated visual system.
- Treat missing/empty generated source sets and highlighting failures for supported languages as build errors with actionable diagnostics.

## Routing migration

- Add Routing and Queries to the Examples registry, navigation, route union, and exhaustive branches. Global navigation contains Home and Examples; Examples remains active for all descendant demo routes.
- Update Routing's internal route prefixes, generated links, navigation targets, and tests to `/examples/routing`, including login, projects, project details, and settings.
- Preserve Routing's ability to interpret its own descendant paths and invalid route parameters. Adapt the outer app's existing descendant handling so direct loads, refreshes, and back/forward navigation reach the routing demo within the Examples shell.
- Internal Routing navigation must preserve the surrounding example page and code viewer, and selecting code files must not affect routing history.
- Update home-page links and any other references to the moved demos. Remove obsolete top-level routes; legacy URLs follow normal not-found behaviour.
- Update bootstrap imports and tests for relocated modules while retaining existing authentication, query partition, shared request, and storage behaviour. Avoid changing resource ownership as an incidental consequence of the move.

## Implementation sequence

1. Move demo modules and their tests into example directories; split Queries by responsibility and preserve existing resource/service identities.
2. Separate registry, route definitions, and page composition. Integrate Routing and Queries under Examples and migrate inner Routing paths.
3. Implement and validate directory/import discovery and Vite development invalidation before adding highlighting.
4. Add build-time Shiki integration and generated per-example source metadata. Keep generated payloads scoped so visiting one example need not load every example's highlighted source.
5. Implement the reusable viewer and responsive page composition, with the demo above it and the mobile selector below the code.
6. Verify behaviour, production output, and repository checks.

## Acceptance and validation

- All eight examples render their live demo and matching source at their Examples URLs. Existing retained URLs and the `/examples` default still work. No old Routing/Queries redirects exist.
- Routing deep links, malformed parameters, refresh, and browser back/forward work under the new prefix. Queries retains shared requests, refresh/failure handling, retained results, and session partition behaviour.
- Discovery tests cover added/renamed/deleted files, shared transitive imports, aliases, type imports, re-exports, cycles, exclusions, package boundaries, unresolved local imports, and deterministic ordering. Validate source-entry association against the live entry.
- Integration checks confirm development picks up file additions/deletions and shared dependency changes, and production emits the same discovered files and source contents.
- Viewer tests cover selecting files without remounting the live demo, selection fallback after deletion, exact copying without line numbers, clipboard failure feedback, and safe rendering of HTML-like source.
- Check desktop and mobile layouts, keyboard navigation, internal overflow, selected filename visibility, and light/dark/system transitions. On mobile the selector is below the code.
- Inspect the production bundle to confirm Shiki and build discovery code are absent from browser JavaScript and examples do not eagerly load all source payloads. Record generated payload sizes to catch accidental infrastructure inclusion.
- Run applicable demo/viewer/discovery tests and `pnpm fmt`, `pnpm lint`, `pnpm typecheck`, and the site production build during implementation. Review formatter changes for unrelated churn.

## Dependency decision

Shiki was selected over Prism and highlight.js for grammar/theme quality and build-time rendering. No dependencies were installed while preparing this spec.

- [Shiki introduction](https://shiki.style/guide/)
- [Shiki fine-grained bundles](https://shiki.style/guide/bundles)
- [Shiki performance guidance](https://shiki.style/guide/best-performance)
- Alternatives discussed: [Prism](https://prismjs.com/docs/index.html) and [highlight.js](https://github.com/highlightjs/highlight.js#readme).
