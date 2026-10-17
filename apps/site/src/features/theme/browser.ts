import { Match, Option } from "effect";
import { type Preference, type ResolvedTheme, decodePreference, storageKey } from "./model";

export interface ThemeBrowser {
  readonly systemDark: () => boolean;
  readonly project: (theme: ResolvedTheme) => void;
  readonly observe: (receive: (preference: Option.Option<Preference>) => void) => () => void;
}
export const browserTheme = (target: Window): ThemeBrowser => {
  const media = target.matchMedia("(prefers-color-scheme: dark)");
  return {
    systemDark: () => media.matches,
    project: (theme) => target.document.body.classList.toggle("dark", theme === "dark"),
    observe: (receive) => {
      const os = () => receive(Option.none());
      const storage = (event: StorageEvent) => {
        try {
          Match.value(
            event.storageArea === target.localStorage &&
              (event.key === storageKey || event.key === null),
          ).pipe(
            Match.when(true, () => receive(Option.some(decodePreference(event.newValue)))),
            Match.when(false, () => {}),
            Match.exhaustive,
          );
        } catch {
          /* Unavailable storage cannot produce usable local-storage events. */
        }
      };
      media.addEventListener("change", os);
      target.addEventListener("storage", storage);
      return () => {
        media.removeEventListener("change", os);
        target.removeEventListener("storage", storage);
      };
    },
  };
};
