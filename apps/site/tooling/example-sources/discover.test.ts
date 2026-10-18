// @vitest-environment node
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Match, Option } from "effect";
import { afterEach, expect, it } from "vitest";
import { discover, importsOf } from "./discover.ts";
import { highlight } from "./highlight.ts";
import { registryEntries } from "./plugin.ts";

const cleanups: string[] = [];
afterEach(async () => {
  for (const directory of cleanups.splice(0)) await rm(directory, { recursive: true, force: true });
});
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "example-sources-"));
  cleanups.push(root);
  const sourceRoot = path.join(root, "src");
  const directory = path.join(sourceRoot, "examples/demo");
  await mkdir(directory, { recursive: true });
  const put = async ({ file, source }: { file: string; source: string }) => {
    const dest = path.join(sourceRoot, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, source);
  };
  const resolve = async ({ specifier, importer }: { specifier: string; importer: string }) => {
    const base = Match.value(specifier.startsWith("~/")).pipe(
      Match.when(true, () => path.join(sourceRoot, specifier.slice(2))),
      Match.when(false, () => path.resolve(path.dirname(importer), specifier)),
      Match.exhaustive,
    );
    for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
      try {
        await readFile(candidate);
        return Option.some(candidate);
      } catch {
        /* Try the next supported resolution. */
      }
    }
    return Option.none<string>();
  };
  return {
    sourceRoot,
    directory,
    put,
    run: () => discover({ sourceRoot, entry: path.join(directory, "example.ts"), resolve }),
  };
};
it("discovers directories, type imports, re-exports, aliases, cycles and shared transitive files deterministically", async () => {
  const f = await fixture();
  await f.put({
    file: "examples/demo/example.ts",
    source:
      'import type { Shared } from "~/shared"; export * from "./z"; import "effect"; import("./dynamic");',
  });
  await f.put({
    file: "shared.ts",
    source: 'export type Shared = string; export * from "./deeper";',
  });
  await f.put({ file: "deeper.ts", source: 'import "./shared"; export const deeper = 1;' });
  await f.put({ file: "examples/demo/z.ts", source: 'import "./example";' });
  await f.put({ file: "examples/demo/dynamic.ts", source: "export const dynamic = 1;" });
  await f.put({ file: "examples/demo/unimported.json", source: '{"included":true}' });
  for (const file of [
    "fixtures/no.ts",
    "example.test.ts",
    "types.d.ts",
    "generated/no.ts",
    "registry.ts",
  ])
    await f.put({ file: `examples/demo/${file}`, source: 'import "./missing";' });
  const result = await f.run();
  expect(result.files.map((file) => file.path)).toEqual([
    "example.ts",
    "dynamic.ts",
    "shared/deeper.ts",
    "shared/shared.ts",
    "unimported.json",
    "z.ts",
  ]);
  expect(result.files[0]?.source).toContain('import "effect"');
  await f.put({ file: "examples/demo/added.ts", source: "export const added = true;" });
  expect((await f.run()).files.map((file) => file.path)).toContain("added.ts");
  await rename(path.join(f.directory, "added.ts"), path.join(f.directory, "renamed.ts"));
  expect((await f.run()).files.map((file) => file.path)).toContain("renamed.ts");
  await rm(path.join(f.directory, "renamed.ts"));
  expect((await f.run()).files.map((file) => file.path)).not.toContain("renamed.ts");
  await f.put({ file: "deeper.ts", source: "export const changed = true;" });
  expect((await f.run()).files.find((file) => file.path === "shared/deeper.ts")?.source).toContain(
    "changed",
  );
});
it("rejects unresolved, unsupported, outside-root and nonliteral dependencies with diagnostics", async () => {
  const f = await fixture();
  await f.put({ file: "examples/demo/example.ts", source: 'import "./missing";' });
  await expect(f.run()).rejects.toThrow("unresolved local import ./missing");
  await f.put({ file: "examples/demo/example.ts", source: 'import "./asset.css";' });
  await f.put({ file: "examples/demo/asset.css", source: "body {}" });
  await expect(f.run()).rejects.toThrow("cannot include ./asset.css");
  await f.put({ file: "examples/demo/example.ts", source: 'import "../../../outside.ts";' });
  await writeFile(path.join(f.sourceRoot, "../outside.ts"), "export {};");
  await expect(f.run()).rejects.toThrow("cannot include ../../../outside.ts");
  expect(() => importsOf({ source: "import(`./${name}`)", filename: "example.ts" })).toThrow(
    "nonliteral dynamic import",
  );
});
it("derives entry associations from live component imports and rejects invalid registrations", () => {
  expect([
    ...registryEntries(
      'import { Demo } from "./demo/example"; export const examples = [{ tag: "Demo", content: Demo }];',
    ),
  ]).toEqual([["Demo", "./demo/example"]]);
  expect(() => registryEntries('const examples = [{tag: "Demo", content: Unknown}];')).toThrow(
    "imported entry component",
  );
  expect(() => registryEntries("const examples = [];")).toThrow("no resolvable entries");
});
it("escapes HTML-like source and generates both themes without changing original text", async () => {
  const source = 'const markup = "<script>alert(1)</script>";\n';
  const file = await highlight({
    id: "example.ts",
    path: "example.ts",
    language: "typescript",
    source,
  });
  expect(file.source).toBe(source);
  expect(file.html).not.toContain("<script>");
  expect(file.html).toContain("&#x3C;script>");
  expect(file.html).toContain("--shiki-light");
  expect(file.html).toContain("--shiki-dark");
  await expect(
    highlight({ id: "bad", path: "bad", language: "unsupported", source }),
  ).rejects.toThrow();
});
