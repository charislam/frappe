# frappé: scoped page metadata

## Purpose and agreed scope

Add reactive document metadata through a dedicated public entry point,
`@charismaticalli/frappe/head`. This spec describes future implementation; it
does not implement the feature.

Support document titles, descriptions, canonical URLs, robots directives,
Open Graph properties, and Twitter card properties. Metadata follows the active
rendered page, including loading, errors, and data arriving after navigation.
Keep the core independent of route definitions: applications already select
their pages and layouts through branches and `cases`.

Implement app defaults, explicit nested scopes, static or reactive metadata,
and browser head reconciliation. Defer route convenience helpers, arbitrary
head elements, scripts, and server rendering infrastructure.

## Public API direction

Provide `Head.root` and `Head.child`, each taking a named options object.
Names and exact signatures remain provisional until implementation type proofs.
Operations must fit existing Frappe context, Effect, and error conventions.

```ts
// Illustrative API; not currently implemented.
const appHead = yield* Head.root({
  context,
  defaults: {
    title: "My app",
    titleTemplate: "%s · My app",
  },
});

const accountsHead = yield* Head.child({
  context,
  parent: appHead,
  metadata: {
    title: "Accounts",
    description: "Manage your accounts.",
  },
});

const detailHead = yield* Head.child({
  context,
  parent: accountsHead,
  metadata: accountMetadata,
});
```

Each declaration accepts a static metadata description or a read-only signal
of the complete description. Use existing derivations to build reactive
metadata; introduce no separate fetching or subscription API. Each scope has
exactly one source established at creation. Update its source signal rather
than attaching additional declarations or replacing individual DOM tags.

## Explicit scope hierarchy and capabilities

Metadata nesting is explicitly declared, independent of component nesting.
Do not infer layouts from names, DOM structure, or route ancestry. A component
participates as a metadata layout by creating a scope and passing the capability
to create a child scope to its page outlet.

The application passes the root handle into top-level page factories. A layout
creates a child scope and passes that handle into its nested page branches.
For example, App -> Accounts layout -> Account detail is one metadata chain.
An intermediate component without a declaration does not create a scope.

Distinguish lifetime from inheritance:

- The creating context owns the scope and determines its disposal.
- The explicit parent handle determines inheritance.
- Validate that a child's owner is within its parent's owner subtree, allowing
  the same owner where appropriate. Reject unrelated, disposed, or foreign
  runtime handles.

Handles are opaque capabilities backed by runtime validation. Do not provide
ambient metadata access to all descendants. Pass handles explicitly through
page/layout factory inputs. Ordinary widgets receive no handle and therefore
cannot use the supported declaration API. Widgets expose useful state to their
page, which derives metadata from that state.

This is an architectural boundary, not a security sandbox: application code
can still directly mutate the document. A component deliberately given a handle
has metadata authority regardless of its name or whether it is called a widget.

## Conflicts and active children

Allow exactly one source per scope and at most one active child per scope.
There is one active inheritance chain. Reject competing children with a
diagnostic identifying the conflicting scopes; never resolve by mount order,
subscription timing, or last update. No general-purpose `Head.attach` operation
adds another source to an existing scope.

A screen with parallel panes must explicitly choose which outlet controls page
metadata. Supporting simultaneous competing metadata branches is out of scope.
Reject competing roots for the same document; use a single document manager.

Branch replacement must retire the old child and activate its replacement as
one metadata reconciliation boundary. Do not report a false sibling conflict
or briefly write inherited defaults between those operations. A genuinely
committed loading or error branch may declare its own metadata.

## Metadata model and resolution

Support these initial fields:

| Field | Browser output |
| --- | --- |
| `title` | Document title / `title` element |
| `titleTemplate` | Formatting rule for the resolved title |
| `description` | `meta[name="description"]` |
| `canonical` | `link[rel="canonical"]` |
| `robots` | `meta[name="robots"]` |
| `openGraph` | Title, description, URL, type, site name, and images |
| `twitter` | Card type, title, description, image, and site |

Resolve from root to active leaf. Missing fields inherit. Explicit values
override. An explicit clear suppresses inherited values and automatic
fallbacks. Represent these semantics internally as `Inherit | Set<A> | Clear`;
do not assign both inheritance and clearing to `Option.none()`. Use `Option`
for resolved absence, consistent with repository conventions. Final public
clear syntax should be ergonomic and type-safe.

Merge structured properties by field. Replace image arrays as a unit rather
than concatenating across scopes. Support image URL and descriptive metadata
such as alternate text and dimensions. Preserve declared image ordering.

Apply the effective title template once to the effective title, rather than
repeatedly at every scope. Define the placeholder contract and validate it.
Open Graph title and description fall back to the resolved page equivalents;
Twitter equivalents fall back to Open Graph. Explicit clearing blocks these
fallbacks. Specify URL and image fallback behavior in the implementation's
public types and tests rather than relying on incidental DOM behavior.

Resolve relative URLs against an explicitly configured public site URL.
Require absolute URLs when no base is configured. Do not derive canonical
URLs automatically from browser location, which may contain transient or
private query parameters.

## Lifecycle and commit behavior

Bind subscriptions and cleanup to existing component ownership. Retiring a
scope removes its contribution and descendants; retiring a leaf reveals its
parent's metadata. Ignore late work from retired owners. Failed activation
must not leave registrations or subscriptions behind.

Resolve and validate complete snapshots before writing the head. Integrate
with reactive commit, structural branch activation, and owner retirement;
independent watchers of attempted navigation are insufficient. Rejected
navigation or failed candidate validation must not publish candidate metadata.
For failures after state has committed, reflect the actual surviving/error
branch instead of claiming the navigation was rolled back.

Batch scope replacement before DOM reconciliation, retaining the previous
snapshot until the replacement boundary has a resolved result. Verify the
exact integration against existing asynchronous branch activation semantics;
do not promise DOM transaction rollback that the framework cannot provide.

## Browser adapter and initial HTML

Use one document manager to reconcile resolved snapshots. Maintain one managed
title and canonical link, and correctly keyed meta elements. Distinguish meta
`name` attributes from Open Graph `property` attributes. Repeated Open Graph
images and their associated properties require ordered identities rather than
deduplication solely by property name.

Update existing nodes where possible and remove obsolete managed nodes,
including trailing image entries. Construct nodes and set text/attributes
through DOM APIs rather than injecting HTML strings.

Manage only explicitly owned elements. Define a bootstrap ownership marker or
manifest for adopting metadata already present in initial HTML. Do not silently
delete arbitrary head elements. Detect conflicting unmanaged singleton tags
and report an actionable bootstrap configuration error. Define root disposal
to restore adopted baseline values and remove newly created managed elements.

## Resolver separation and social previews

Keep inheritance, validation, normalization, and fallback resolution in a pure
resolver producing a document-independent snapshot. Put browser mutation in a
separate adapter. This keeps the same metadata model usable by future server
rendering or prerendering.

Client navigation updates do not by themselves guarantee social previews:
the HTML returned for a shared URL is a separate delivery concern. Do not
describe this initial browser feature as complete crawler/social-preview
support. Server rendering infrastructure is outside this implementation scope.

## Acceptance criteria

- Static and signal-driven titles and tags update without page reloads.
- Root/layout/page inheritance, explicit clearing, title formatting, and
  documented social fallbacks resolve deterministically.
- Nested branch disposal restores the surviving parent contribution.
- Sibling conflicts, duplicate roots, invalid handles, and unrelated owners
  fail explicitly without corrupting the current snapshot.
- Branch replacement creates neither false conflicts nor transient default
  writes; retained branches support reactive metadata updates.
- Rejected navigation, failed activation, and stale asynchronous work cannot
  publish metadata belonging to an inactive page.
- Reconciliation removes obsolete tags and image entries, preserves ordered
  image properties, and leaves unrelated head elements untouched.
- Bootstrap adoption and root disposal obey the ownership contract.
- Type checks demonstrate that widget inputs lacking a scope handle cannot
  invoke child declaration, and that static and reactive descriptions infer
  correctly without exposing internal runtime capabilities.
- Resolver tests run independently of a browser; lifecycle and DOM tests cover
  the integration boundaries above.

Implementation must pass `pnpm fmt`, `pnpm lint`, and `pnpm typecheck`, plus
focused resolver, lifecycle, and browser reconciliation tests.
