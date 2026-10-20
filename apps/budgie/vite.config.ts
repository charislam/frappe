import { Match } from "effect";
import { build, defineConfig } from "vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { host: "localhost", port: 5174, strictPort: true },
  plugins: [
    {
      name: "budgie-theme",
      transformIndexHtml: {
        order: "pre",
        async handler() {
          const result = await build({
            configFile: false,
            build: {
              write: false,
              minify: true,
              lib: { entry: "src/theme/early.ts", name: "BudgieTheme", formats: ["iife"] },
            },
          });
          const outputs = Match.value(result).pipe(
            Match.when(Array.isArray, (result) => result),
            Match.orElse((result) => [result]),
          );
          const code = outputs
            .flatMap((output) =>
              Match.value(output).pipe(
                Match.when(
                  (output) => "output" in output,
                  (output) => output.output,
                ),
                Match.orElse(() => []),
              ),
            )
            .filter((output) => output.type === "chunk")
            .map((output) => output.code)
            .join("\n");
          return [{ tag: "script", children: code, injectTo: "head-prepend" }];
        },
      },
    },
  ],
});
