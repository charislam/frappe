import { Sync, component, nativeNode } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { type SourceFiles, type SourceSet, selectedFile } from "./model";

const viewer = (options: {
  files: SourceFiles;
  selected: string;
  onSelect: (id: string) => void;
}) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const { files } = options;
          const selected = yield* context.signal({ initial: options.selected });
          const filename = yield* context.derive({
            sources: { selected },
            compute: ({ selected }) => selectedFile({ files, selected }).path,
          });
          const feedback = yield* context.signal({ initial: "" });
          const copy = yield* context.he("button", {
            props: { type: "button" },
            children: ["Copy file"],
          });
          const code = yield* context.he("div", {
            attrs: {
              class: Option.some("source-code"),
              "aria-label": Option.some("Source code"),
              role: Option.some("region"),
            },
            props: { tabIndex: 0 },
          });
          const select = yield* context.he("select", {
            attrs: { "aria-label": Option.some("Source file") },
            props: { value: selected },
            children: yield* Effect.forEach(files, (file) =>
              context.he("option", { props: { value: file.id }, children: [file.path] }),
            ),
          });
          const choose = (id: string) =>
            Effect.gen(function* () {
              yield* selected.set(id);
              yield* feedback.set("");
              options.onSelect(id);
              render(id);
            });
          const list = [];
          for (const file of files) {
            const current = yield* context.derive({
              sources: { selected },
              compute: ({ selected }) => Option.some(String(selected === file.id)),
            });
            const button = yield* context.he("button", {
              attrs: { "aria-pressed": current },
              props: { type: "button" },
              children: [file.path],
            });
            yield* context.subscribe(yield* context.events(button, "click"), () => choose(file.id));
            list.push(button);
          }
          const render = (id: string) => {
            const file = selectedFile({ files, selected: id });
            // Only escaped, generated Shiki output enters this sink. Raw source is used only for copying.
            const target = nativeNode(code);
            target.innerHTML = file.html;
            target.scrollTop = 0;
            target.scrollLeft = 0;
            nativeNode(select).value = file.id;
          };
          render(options.selected);
          yield* context.subscribe(yield* context.events(select, "change"), () =>
            choose(nativeNode(select).value),
          );
          const copyResults = new WeakMap<MouseEvent, Promise<string>>();
          const copyEvents = yield* context.events(copy, "click", {
            // WebKit requires the clipboard call itself to remain inside the native user gesture.
            synchronous: (event) => {
              try {
                const id = Effect.runSync(selected.get);
                const result = navigator.clipboard.writeText(
                  selectedFile({ files, selected: id }).source,
                );
                copyResults.set(
                  event,
                  result.then(
                    () => "File copied.",
                    () => "Copy failed. Please try again.",
                  ),
                );
              } catch {
                copyResults.set(event, Promise.resolve("Copy failed. Please try again."));
              }
            },
          });
          yield* context.subscribe(copyEvents, (event) =>
            Effect.promise(() =>
              Option.getOrElse(Option.fromUndefinedOr(copyResults.get(event)), () =>
                Promise.resolve("Copy failed. Please try again."),
              ),
            ).pipe(Effect.flatMap(feedback.set)),
          );
          const output = yield* context.he("section", {
            attrs: {
              class: Option.some("code-viewer"),
              "aria-label": Option.some("Example source"),
            },
            children: [
              yield* context.he("header", {
                children: [
                  yield* context.he("strong", {
                    attrs: { class: Option.some("source-filename") },
                    children: [filename],
                  }),
                  copy,
                  yield* context.he("span", {
                    attrs: { role: Option.some("status") },
                    children: [feedback],
                  }),
                ],
              }),
              yield* context.he("div", {
                attrs: { class: Option.some("source-layout") },
                children: [
                  yield* context.he("nav", {
                    attrs: {
                      class: Option.some("source-files"),
                      "aria-label": Option.some("Source files"),
                    },
                    children: list,
                  }),
                  code,
                ],
              }),
              yield* context.he("label", {
                attrs: { class: Option.some("source-mobile-selector") },
                children: ["Source file", select],
              }),
            ],
          });
          return output;
        }),
    }),
  );

export const CodeViewer = (files: SourceFiles) =>
  viewer({ files, selected: files[0].id, onSelect: () => {} });

export const LiveCodeViewer = (source: SourceSet) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          let selected = source.files[0].id;
          const content = (files: SourceFiles) => {
            selected = selectedFile({ files, selected }).id;
            return viewer({
              files,
              selected,
              onSelect: (id) => {
                selected = id;
              },
            });
          };
          const current = yield* context.signal({ initial: Option.some(content(source.files)) });
          const dispose = source.subscribe((files) => {
            Effect.runSync(current.set(Option.some(content(files))));
          });
          yield* context.addFinalizer(Effect.sync(dispose));
          return current;
        }),
    }),
  );
