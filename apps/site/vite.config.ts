import { build, defineConfig, type Plugin } from "vite";

const themeInitializer = (): Plugin => ({
  name: "theme-initializer",
  transformIndexHtml: {
    order: "pre",
    async handler() {
      const result = await build({
        configFile: false,
        resolve: { tsconfigPaths: true },
        build: {
          write: false,
          minify: true,
          lib: { entry: "src/features/theme/early.ts", name: "FrappeTheme", formats: ["iife"] },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const chunk = outputs
        .flatMap((output) => ("output" in output ? output.output : []))
        .find((output) => output.type === "chunk");
      if (!chunk || chunk.type !== "chunk") throw new Error("Theme initializer bundle missing");
      return [{ tag: "script", children: chunk.code, injectTo: "body-prepend" }];
    },
  },
});
export default defineConfig({
  plugins: [themeInitializer()],
  resolve: { tsconfigPaths: true },
});
