import { Effect, Option } from "effect";
import { LocalStorage, LocalStorageLive, storageDiagnostic } from "~/local-storage";
import { type Preference, decodePreference, resolveTheme, storageKey } from "./model";

declare global {
  interface Window {
    frappeTheme?: Preference;
  }
}
export const readPreference = Effect.fn("Theme.readPreference")(function* () {
  const storage = yield* LocalStorage;
  return yield* storage.get(storageKey).pipe(
    Effect.map((value) => decodePreference(Option.getOrNull(value))),
    Effect.catch(() => storageDiagnostic().pipe(Effect.as("system" as const))),
  );
});
export const initialize = () => {
  const preference = Effect.runSync(readPreference().pipe(Effect.provide(LocalStorageLive)));
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.body.classList.toggle("dark", resolveTheme({ preference, systemDark }) === "dark");
  window.frappeTheme = preference;
};
