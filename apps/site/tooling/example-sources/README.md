# Example source pipeline

`src/examples/registry.ts` is the source of truth for both live components and source entry modules. The Vite plugin parses the registry’s actual imports, resolves entries with Vite, and discovers their directory contents and outgoing local imports. Discovery stays inside the site source root and stops at package boundaries.

The build produces one lazy virtual source module per example. Shiki runs only in development/build tooling and emits escaped HTML with both theme variants. The viewer switches theme through CSS, copies original source, and keeps file selection separate from the live demo.

Development watches the complete source directory, including additions and deletions, invalidates virtual source modules, and sends HMR updates. Source updates retain an existing selected file or fall back to the entry. Changes to live application modules also follow Vite’s normal application reload behavior.
