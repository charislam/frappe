import { Match, Schema } from "effect";
export const Preference = Schema.Literals(["light", "dark", "system"]);
export type Preference = typeof Preference.Type;
export const storageKey = "budgie.public_preferences.theme";
export const decodePreference = (value: unknown): Preference =>
  Match.value(value).pipe(
    Match.when("light", () => "light" as const),
    Match.when("dark", () => "dark" as const),
    Match.orElse(() => "system" as const),
  );
export const resolveTheme = (options: {
  preference: Preference;
  systemDark: boolean;
}): "light" | "dark" =>
  Match.value(options.preference).pipe(
    Match.when("light", () => "light" as const),
    Match.when("dark", () => "dark" as const),
    Match.when("system", () =>
      Match.value(options.systemDark).pipe(
        Match.when(true, () => "dark" as const),
        Match.orElse(() => "light" as const),
      ),
    ),
    Match.exhaustive,
  );
export interface ThemeStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}
export const readPreference = (storage: () => ThemeStorage): Preference => {
  try {
    return decodePreference(storage().getItem(storageKey));
  } catch {
    return "system";
  }
};
export const savePreference = (options: {
  storage: () => ThemeStorage;
  preference: Preference;
}): void => {
  try {
    options.storage().setItem(storageKey, options.preference);
  } catch {
    /* Selection remains usable in memory. */
  }
};
