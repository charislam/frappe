# Page metadata

Import the dedicated namespace with:

```ts
import * as Head from "@charismaticalli/frappe/head";
```

Create one root for the document during application startup. `Head.root` returns
`Effect<Head.Handle, ReactiveError>`:

```ts
const appHead =
  yield *
  Head.root({
    context: app,
    document,
    siteUrl: "https://example.com",
    defaults: { title: "Example", titleTemplate: "%s · Example" },
  });
```

Declare page or layout metadata in its component factory. `Head.child` returns
`Sync<Head.Handle, ReactiveError>` and can be yielded from `Sync.gen`:

```ts
import { Sync, component } from "@charismaticalli/frappe";

const Accounts = component((context) =>
  Sync.gen(function* () {
    yield* Head.child({
      context,
      parent: appHead,
      metadata: { title: "Accounts", description: "Manage accounts." },
    });
    return {
      setup: (context) => loadAccounts(context),
    };
  }),
);
```

Here `loadAccounts` is application code returning the page output as an Effect;
it may await asynchronous work. A layout keeps the returned child handle and
passes it to its nested page factories.

Pass handles explicitly to page and layout factories. The creating context owns
the declaration; the parent handle controls inheritance. A handle allows one
active child, and children must belong to the parent's owner subtree and runtime.
Ordinary widget inputs need no handle.

Both sources accept a static description or a read-only signal of the complete
description. Omitted fields inherit; Head.clear clears a field and blocks fallbacks.
Structured social metadata merges by property, while image arrays replace as a
unit. Templates require exactly one %s and apply once to the final title.
Open Graph title and description fall back to the page equivalents; Twitter
title and description fall back to Open Graph. URL and image properties have no
automatic fallback. Relative URLs require siteUrl. Canonical URLs never derive
from browser location.

Initial HTML metadata must carry data-frappe-head. The adapter rejects unmanaged
title, canonical, description, robots, Open Graph and Twitter tags before writing.
Other head elements remain untouched. Disposal restores adopted node values and
removes newly created nodes. Initial managed nodes retain their identity.

Signal candidates validate before navigation and signal state commit. Factory
registration validates metadata but does not publish an uncommitted occurrence.
Metadata becomes eligible when its occurrence and ancestors commit into the
active tree, including when the occurrence contains a fallback or empty
placeholder. It does not wait for asynchronous setup or descendant loading.

Declare one title for both loading and loaded content. Signal-driven metadata
continues updating while content loads. A fallback needs no separate declaration;
if it declares an override, that override follows the fallback owner's lifetime.
Retirement removes a scope's contribution and reveals its surviving parent.
Structural replacement reconciles once at the commit boundary, without an
intermediate write of defaults. An uncommitted replacement contributes nothing.
A failure after state commit follows the surviving component tree; there is no
promise of DOM rollback.

The pure resolve function returns Result<Snapshot, MetadataError>. Invalid title
templates and URLs produce recoverable failures. The head lifecycle translates
these failures into the existing ReactiveError channel before commit. This browser
feature does not provide server rendering or guarantee crawler/social previews.
