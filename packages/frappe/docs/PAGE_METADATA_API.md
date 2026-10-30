# Page metadata

Import the dedicated namespace with:

```ts
import * as Head from "@charismaticalli/frappe/head";
```

In an Effect setup, create one root for the document:

```ts
const appHead =
  yield *
  Head.root({
    context,
    document,
    siteUrl: "https://example.com",
    defaults: { title: "Example", titleTemplate: "%s · Example" },
  });
const pageHead =
  yield *
  Head.child({
    context,
    parent: appHead,
    metadata: { title: "Accounts", description: "Manage accounts." },
  });
```

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

Signal candidates validate before navigation and signal state commit. Structural
replacements defer reconciliation through component presentation, retaining the
previous snapshot while setup is pending. A rendered fallback may own its own
declaration. A failure after state commit follows the surviving component tree;
there is no promise of DOM rollback.

The pure resolve function returns Result<Snapshot, MetadataError>. Invalid title
templates and URLs produce recoverable failures. The head lifecycle translates
these failures into the existing ReactiveError channel before commit. This browser
feature does not provide server rendering or guarantee crawler/social previews.
