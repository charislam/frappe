/// <reference types="vite/client" />

declare module "virtual:example-sources" {
  import type { ExampleTag } from "~/examples/routes";
  import type { SourceSet } from "~/features/code-viewer/model";
  export const sourceLoaders: Record<ExampleTag, () => Promise<SourceSet>>;
}
