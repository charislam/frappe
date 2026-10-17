import { Sync, component, nativeNode, occurrenceId } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { Theme } from "./controller";
import { type Preference, decodePreference } from "./model";

const iconPaths = {
  light:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42",
  dark: "M20.9 13.1A9 9 0 0 1 10.9 3.1 9 9 0 1 0 20.9 13.1Z",
  system: "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM12 17v4m-4 0h8",
} satisfies Record<Preference, string>;

const themeIcon = (preference: Preference) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", iconPaths[preference]);
  svg.append(path);
  return svg;
};

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
        const title = yield* context.derive({
          sources: { preference: theme.preference },
          compute: ({ preference }) =>
            Option.some(
              Match.value(preference).pipe(
                Match.when("light", () => "Theme: Light"),
                Match.when("dark", () => "Theme: Dark"),
                Match.when("system", () => "Theme: System"),
                Match.exhaustive,
              ),
            ),
        });
        const icons = [];
        for (const preference of ["light", "dark", "system"] as const) {
          const hidden = yield* context.derive({
            sources: { preference: theme.preference },
            compute: (current) => current.preference !== preference,
          });
          icons.push(
            yield* context.he("span", {
              attrs: {
                "aria-hidden": Option.some("true"),
                "data-theme-icon": Option.some(preference),
              },
              props: { hidden },
              children: [yield* context.importNative(themeIcon(preference))],
            }),
          );
        }
        const select = yield* context.he("select", {
          attrs: { id: Option.some(id), title },
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
            ...icons,
          ],
        });
      }),
  }),
);
