import { Sync, component, nativeNode, occurrenceId } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { Theme } from "./controller";
import { type Preference, decodePreference } from "./model";

export const ThemeSelector = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const theme = yield* Theme;
        const id = occurrenceId("theme");
        const options = [];
        for (const label of ["Light", "Dark", "System"])
          options.push(
            yield* context.he("option", {
              props: { value: label.toLowerCase() },
              children: [label],
            }),
          );
        const select = yield* context.he("select", {
          attrs: { id: Option.some(id) },
          props: { value: theme.preference },
          children: options,
        });
        const selections = new WeakMap<Event, Preference>();
        yield* context.subscribe(
          yield* context.events(select, "change", {
            synchronous: (event) =>
              selections.set(event, decodePreference(nativeNode(select).value)),
          }),
          (event) => theme.select({ preference: decodePreference(selections.get(event)) }),
        );
        return yield* context.he("div", {
          attrs: { class: Option.some("app-theme-selector") },
          children: [
            yield* context.he("label", { attrs: { for: Option.some(id) }, children: ["Theme"] }),
            select,
          ],
        });
      }),
  }),
);
