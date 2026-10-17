import { Match, Schema } from "effect";

export const Preference = Schema.Literals(["light", "dark", "system"]);
export type Preference = typeof Preference.Type;
export type ResolvedTheme = "light" | "dark";
export const storageKey = "frappe.theme";
export const decodePreference = (value: unknown): Preference =>
  Match.value(value).pipe(
    Match.when("light", () => "light" as const),
    Match.when("dark", () => "dark" as const),
    Match.orElse(() => "system" as const),
  );
export const resolveTheme = (options: {
  preference: Preference;
  systemDark: boolean;
}): ResolvedTheme =>
  Match.value(options.preference).pipe(
    Match.when("light", () => "light" as const),
    Match.when("dark", () => "dark" as const),
    Match.when("system", () =>
      Match.value(options.systemDark).pipe(
        Match.when(true, () => "dark" as const),
        Match.when(false, () => "light" as const),
        Match.exhaustive,
      ),
    ),
    Match.exhaustive,
  );
