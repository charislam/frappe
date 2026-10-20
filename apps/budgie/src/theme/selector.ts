import {
  type ElementOutput,
  Sync,
  component,
  nativeNode,
  occurrenceId,
} from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { themeIcon } from "./icon";
import {
  type Preference,
  decodePreference,
  readPreference,
  resolveTheme,
  savePreference,
  storageKey,
} from "./model";

export const ThemeSelector = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        let preference: Preference = readPreference(() => window.localStorage);
        const id = occurrenceId("budgie-theme");
        const icons: Array<{
          readonly preference: Preference;
          readonly element: ElementOutput<HTMLSpanElement>;
        }> = [];
        for (const value of ["light", "dark", "system"] as const) {
          const icon = yield* context.he("span", {
            attrs: { "aria-hidden": Option.some("true"), "data-theme-icon": Option.some(value) },
            props: { hidden: value !== preference },
            children: [yield* context.importNative(themeIcon(value))],
          });
          icons.push({ preference: value, element: icon });
        }
        const select = yield* context.he("select", {
          attrs: { id: Option.some(id) },
          props: { value: preference },
          children: [
            yield* context.he("option", { props: { value: "system" }, children: ["System"] }),
            yield* context.he("option", { props: { value: "light" }, children: ["Light"] }),
            yield* context.he("option", { props: { value: "dark" }, children: ["Dark"] }),
          ],
        });
        const apply = () => {
          document.documentElement.dataset["theme"] = resolveTheme({
            preference,
            systemDark: media.matches,
          });
          nativeNode(select).value = preference;
          nativeNode(select).title = Match.value(preference).pipe(
            Match.when("light", () => "Theme: Light"),
            Match.when("dark", () => "Theme: Dark"),
            Match.when("system", () => "Theme: System"),
            Match.exhaustive,
          );
          for (const icon of icons)
            nativeNode(icon.element).hidden = icon.preference !== preference;
        };
        const storage = (event: StorageEvent) => {
          try {
            Match.value(
              event.storageArea === window.localStorage &&
                (event.key === storageKey || event.key === null),
            ).pipe(
              Match.when(true, () => {
                preference = decodePreference(event.newValue);
                apply();
              }),
              Match.orElse(() => {}),
            );
          } catch {
            /* Storage may be unavailable. */
          }
        };
        media.addEventListener("change", apply);
        window.addEventListener("storage", storage);
        apply();
        yield* context.addFinalizer(
          Effect.sync(() => {
            media.removeEventListener("change", apply);
            window.removeEventListener("storage", storage);
          }),
        );
        yield* context.subscribe(yield* context.events(select, "change"), () =>
          Effect.sync(() => {
            preference = decodePreference(nativeNode(select).value);
            savePreference({ storage: () => window.localStorage, preference });
            apply();
          }),
        );
        return yield* context.he("div", {
          attrs: { class: Option.some("app-theme-selector") },
          children: [
            yield* context.he("label", {
              attrs: { for: Option.some(id) },
              children: ["Appearance"],
            }),
            select,
            ...icons.map((icon) => icon.element),
          ],
        });
      }),
  }),
);
