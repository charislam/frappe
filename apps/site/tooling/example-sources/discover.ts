import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Match, Option } from "effect";
import { Visitor, parseSync } from "vite";

export const languages = new Map([
  [".ts", "typescript"],
  [".tsx", "tsx"],
  [".js", "javascript"],
  [".jsx", "jsx"],
  [".mjs", "javascript"],
  [".json", "json"],
]);
const excluded = (file: string) =>
  /(?:^|[/\\])(?:__fixtures__|fixtures|__tests__|node_modules|dist|generated)(?:[/\\]|$)|\.(?:test|spec|d)\.[cm]?[jt]sx?$|(?:^|[/\\])registry\.[jt]s$/.test(
    file,
  );
export interface DiscoveredFile {
  readonly id: string;
  readonly path: string;
  readonly language: string;
  readonly source: string;
}
export type ResolveLocal = (options: {
  specifier: string;
  importer: string;
}) => Promise<Option.Option<string>>;
export const requireSource = <T>(options: { value: Option.Option<T>; message: string }): T =>
  Option.getOrThrowWith(options.value, () => new Error(options.message));
export const assertSource = (options: { valid: boolean; message: string }): void =>
  Match.value(options.valid).pipe(
    Match.when(true, () => {}),
    Match.when(false, () => {
      throw new Error(options.message);
    }),
    Match.exhaustive,
  );
export const importsOf = (options: { source: string; filename: string }): string[] =>
  Match.value(path.extname(options.filename)).pipe(
    Match.when(".json", () => {
      JSON.parse(options.source);
      return [];
    }),
    Match.orElse(() => {
      const parsed = parseSync(options.filename, options.source);
      assertSource({
        valid: parsed.errors.length === 0,
        message: `${options.filename}: ${parsed.errors.map((error) => error.message).join("; ")}`,
      });
      const imports: string[] = [];
      new Visitor({
        ImportDeclaration: (node) => {
          imports.push(node.source.value);
        },
        ExportNamedDeclaration: (node) => {
          Option.fromNullishOr(node.source).pipe(
            Option.map((source) => imports.push(source.value)),
          );
        },
        ExportAllDeclaration: (node) => {
          imports.push(node.source.value);
        },
        ImportExpression: (node) =>
          Match.value(node.source).pipe(
            Match.when({ type: "Literal", value: Match.string }, (source) => {
              imports.push(source.value);
            }),
            Match.orElse(() => {
              throw new Error(
                `${options.filename}: nonliteral dynamic import requires explicit resolution`,
              );
            }),
          ),
      }).visit(parsed.program);
      return imports;
    }),
  );
export const discover = async (options: {
  entry: string;
  sourceRoot: string;
  resolve: ResolveLocal;
}) => {
  const root = await realpath(options.sourceRoot);
  const entry = await realpath(options.entry);
  const directory = path.dirname(entry);
  const found = new Map<string, DiscoveredFile>();
  const inside = (file: string) =>
    !path.relative(root, file).startsWith("..") && !path.isAbsolute(path.relative(root, file));
  const visit = async (filename: string): Promise<void> => {
    const file = await realpath(filename);
    assertSource({
      valid: inside(file),
      message: `Source dependency outside site source root: ${filename}`,
    });
    await Match.value(found.has(file) || excluded(file)).pipe(
      Match.when(true, async () => {}),
      Match.when(false, async () => {
        const language = requireSource({
          value: Option.fromUndefinedOr(languages.get(path.extname(file))),
          message: `Unsupported source dependency: ${filename}`,
        });
        const source = await readFile(file, "utf8");
        const local = path.relative(directory, file);
        const display = Match.value(local.startsWith(".."))
          .pipe(
            Match.when(true, () => `shared/${path.relative(root, file)}`),
            Match.orElse(() => local),
          )
          .split(path.sep)
          .join("/");
        found.set(file, { id: display, path: display, source, language });
        const localImports = importsOf({ source, filename: file }).filter(
          (specifier) =>
            specifier.startsWith(".") || specifier.startsWith("~/") || specifier.startsWith("/"),
        );
        for (const specifier of localImports) {
          const resolved = requireSource({
            value: await options.resolve({ specifier, importer: file }),
            message: `${file}: unresolved local import ${specifier}`,
          });
          try {
            await visit(resolved);
          } catch (error) {
            throw new Error(`${file}: cannot include ${specifier}: ${String(error)}`, {
              cause: error,
            });
          }
        }
      }),
      Match.exhaustive,
    );
  };
  const enumerate = async (dir: string): Promise<void> => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      await Match.value({
        excluded: excluded(file),
        directory: item.isDirectory(),
        eligible: languages.has(path.extname(file)),
      }).pipe(
        Match.when({ excluded: true }, async () => {}),
        Match.when({ directory: true }, () => enumerate(file)),
        Match.when({ eligible: true }, () => visit(file)),
        Match.orElse(async () => {}),
      );
    }
  };
  await visit(entry);
  await enumerate(directory);
  const first = requireSource({
    value: Option.fromUndefinedOr(found.get(entry)),
    message: `Entry excluded or empty source set: ${entry}`,
  });
  return {
    files: [
      first,
      ...[...found.entries()]
        .filter(([file]) => file !== entry)
        .map(([, file]) => file)
        .sort((a, b) => a.path.localeCompare(b.path, "en")),
    ],
    dependencies: [...found.keys()],
  };
};
