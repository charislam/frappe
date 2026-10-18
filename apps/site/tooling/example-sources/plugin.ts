import { readFile } from "node:fs/promises";
import path from "node:path";
import { Match, Option } from "effect";
import { type Plugin, type ResolvedConfig, Visitor, parseSync } from "vite";
import { assertSource, discover, requireSource } from "./discover.ts";
import { highlight } from "./highlight.ts";

const prefix = "virtual:example-source/";
// Read component imports and registration together, without executing application code.
export const registryEntries = (source: string) => {
  const parsed = parseSync("registry.ts", source);
  assertSource({ valid: parsed.errors.length === 0, message: "Example registry cannot be parsed" });
  const imports = new Map<string, string>();
  const entries = new Map<string, string>();
  new Visitor({
    ImportDeclaration: (node) => {
      for (const specifier of node.specifiers) imports.set(specifier.local.name, node.source.value);
    },
  }).visit(parsed.program);
  new Visitor({
    ObjectExpression: (node) => {
      const properties = new Map(
        node.properties.flatMap((property) =>
          Match.value(property).pipe(
            Match.when({ type: "Property", key: { type: "Identifier" } }, (property) => [
              [property.key.name, property.value] as const,
            ]),
            Match.orElse(() => []),
          ),
        ),
      );
      Match.value({ tag: properties.get("tag"), content: properties.get("content") }).pipe(
        Match.when(
          { tag: { type: "Literal", value: Match.string }, content: { type: "Identifier" } },
          ({ tag, content }) => {
            const specifier = requireSource({
              value: Option.fromUndefinedOr(imports.get(content.name)),
              message: `Example ${tag.value}: content must refer to an imported entry component`,
            });
            assertSource({
              valid: !entries.has(tag.value),
              message: `Duplicate example identity ${tag.value}`,
            });
            entries.set(tag.value, specifier);
          },
        ),
        Match.when({ tag: { type: "Literal", value: Match.string } }, ({ tag }) => {
          throw new Error(`Example ${tag.value}: content must be an imported component`);
        }),
        Match.orElse(() => {}),
      );
    },
  }).visit(parsed.program);
  assertSource({ valid: entries.size > 0, message: "Example registry has no resolvable entries" });
  return entries;
};
const sourceModule = (files: unknown) => `let files = ${JSON.stringify(files)};
const listeners = import.meta.hot?.data?.listeners ?? new Set();
export default { get files() { return files; }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
import.meta.hot?.accept(next => { files = next.default.files; for (const listener of listeners) listener(files); });
Object.assign(import.meta.hot?.data ?? {}, { listeners });`;

export const exampleSources = (): Plugin => {
  let config: ResolvedConfig;
  return {
    name: "example-sources",
    configResolved(value) {
      config = value;
    },
    resolveId(id) {
      return Match.value(id === "virtual:example-sources" || id.startsWith(prefix)).pipe(
        Match.when(true, () => `\0${id}`),
        Match.orElse(() => undefined),
      );
    },
    async load(id) {
      return Match.value(id.startsWith("\0virtual:example-source")).pipe(
        Match.when(false, async () => undefined),
        Match.when(true, async () => {
          const registry = path.join(config.root, "src/examples/registry.ts");
          this.addWatchFile(registry);
          const entries = registryEntries(await readFile(registry, "utf8"));
          return Match.value(id).pipe(
            Match.when(
              "\0virtual:example-sources",
              () =>
                `export const sourceLoaders = {${[...entries.keys()].map((tag) => `${JSON.stringify(tag)}: () => import(${JSON.stringify(prefix + tag)}).then(m => m.default)`).join(",")}};`,
            ),
            Match.orElse(async () => {
              const tag = id.slice(prefix.length + 1);
              const specifier = requireSource({
                value: Option.fromUndefinedOr(entries.get(tag)),
                message: `Unknown example source identity ${tag}`,
              });
              const entry = requireSource({
                value: Option.fromNullishOr(await this.resolve(specifier, registry)),
                message: `Example ${tag}: cannot resolve live component ${specifier}`,
              });
              assertSource({
                valid: !entry.external,
                message: `Example ${tag}: live component must be a local module`,
              });
              const result = await discover({
                entry: entry.id,
                sourceRoot: path.join(config.root, "src"),
                resolve: async ({ specifier, importer }) => {
                  const resolved = await this.resolve(specifier, importer);
                  return Option.fromNullishOr(resolved?.id);
                },
              });
              for (const file of result.dependencies) this.addWatchFile(file);
              const files = await Promise.all(result.files.map(highlight));
              this.info(
                `${tag}: ${files.length} source files, ${Buffer.byteLength(JSON.stringify(files))} bytes`,
              );
              return sourceModule(files);
            }),
          );
        }),
        Match.exhaustive,
      );
    },
    configureServer(server) {
      // Directory-level watching includes files that do not exist in the initial graph.
      const sourceRoot = path.join(config.root, "src");
      server.watcher.add(sourceRoot);
      server.watcher.on("all", (_event, file) =>
        Match.value(file.startsWith(`${sourceRoot}${path.sep}`)).pipe(
          Match.when(true, () => {
            const modules = [...server.moduleGraph.idToModuleMap.values()].filter((module) =>
              module.id?.startsWith(`\0${prefix}`),
            );
            for (const module of modules) server.moduleGraph.invalidateModule(module);
            for (const module of modules) void server.reloadModule(module);
          }),
          Match.orElse(() => {}),
        ),
      );
    },
  };
};
