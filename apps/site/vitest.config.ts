import { defineConfig } from "vitest/config";
import { exampleSources } from "./tooling/example-sources/plugin.ts";

export default defineConfig({
  plugins: [exampleSources()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "tooling/**/*.test.ts"],
    environmentOptions: {
      happyDOM: {
        settings: {
          navigation: {
            disableMainFrameNavigation: true,
            disableChildFrameNavigation: true,
            disableChildPageNavigation: true,
          },
        },
      },
    },
  },
});
