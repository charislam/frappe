// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Match } from "effect";
import { build, createServer } from "vite";
import { expect, it, vi } from "vitest";
import { exampleSources } from "./plugin.ts";

it("invalidates development source on additions, deletion and shared edits and matches production discovery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "example-plugin-"));
  const directory = path.join(root, "src/examples/demo");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(root, "src/examples/registry.ts"),
    'import { Demo } from "./demo/example"; export const examples = [{ tag: "Demo", content: Demo }];',
  );
  await writeFile(
    path.join(directory, "example.ts"),
    'import "../../shared"; export const Demo = 1;',
  );
  await writeFile(path.join(root, "src/shared.ts"), "export const shared = 1;");
  const server = await createServer({
    root,
    configFile: false,
    plugins: [exampleSources()],
    server: { middlewareMode: true, ws: false, watch: { usePolling: true, interval: 25 } },
  });
  try {
    const request = () => server.transformRequest("virtual:example-source/Demo");
    const initial = await request();
    expect(initial?.code).toContain("shared/shared.ts");
    expect(initial?.code).toContain("example.ts");
    const reload = vi.spyOn(server, "reloadModule");
    const added = path.join(directory, "new.ts");
    await writeFile(added, "export const added = 1;");
    await vi.waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 3000 });
    expect((await request())?.code).toContain("new.ts");
    reload.mockClear();
    await writeFile(path.join(root, "src/shared.ts"), "export const shared = 42;");
    await vi.waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 3000 });
    const edited = await request();
    expect(edited?.code).toContain("export const shared = 42;");
    reload.mockClear();
    await rm(added);
    await vi.waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 3000 });
    const removed = await request();
    expect(removed?.code).not.toContain("new.ts");
    expect(removed?.code).toContain("import.meta.hot");
    await writeFile(
      path.join(root, "src/main.ts"),
      'export { sourceLoaders } from "virtual:example-sources";',
    );
    const output = await build({
      root,
      configFile: false,
      plugins: [exampleSources()],
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        lib: { entry: path.join(root, "src/main.ts"), formats: ["es"] },
      },
    });
    const outputs = Match.value(output).pipe(
      Match.when(Array.isArray, (outputs) => outputs),
      Match.orElse((output) => [output]),
    );
    const chunks = outputs
      .flatMap((item) =>
        Match.value(item).pipe(
          Match.when(
            (item) => "output" in item,
            (item) => item.output,
          ),
          Match.orElse(() => []),
        ),
      )
      .filter((item) => item.type === "chunk");
    const entry = chunks.find((chunk) => chunk.isEntry);
    const source = chunks.find((chunk) => !chunk.isEntry);
    expect(entry?.code).not.toContain("export const shared = 42;");
    expect(source?.code).toContain("export const shared = 42;");
    expect(source?.code).toContain("shared/shared.ts");
    expect(source?.code).not.toContain("new.ts");
    expect(source?.code).not.toContain("createHighlighter");
    expect(source?.code).not.toContain("node:fs");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}, 10000);
