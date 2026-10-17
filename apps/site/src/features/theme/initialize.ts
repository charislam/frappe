import { Effect, Option } from "effect";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import { acquireStorage, storageDiagnostic } from "~/storage";
import { type Preference, decodePreference, resolveTheme, storageKey } from "./model";

declare global {
  interface Window {
    frappeTheme?: Preference;
  }
}
const readPreference = Effect.fn("Theme.readPreference")(function* () {
  const storage = yield* acquireStorage(() => window.localStorage);
  return yield* Option.match(storage, {
    onNone: () => Effect.succeed("system" as const),
    onSome: (storage) =>
      Effect.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        return yield* store.get(storageKey).pipe(
          Effect.map(decodePreference),
          Effect.catch(() => storageDiagnostic().pipe(Effect.as("system" as const))),
        );
      }).pipe(Effect.provide(KeyValueStore.layerStorage(() => storage))),
  });
});
export const initialize = () => {
  const preference = Effect.runSync(readPreference());
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.body.classList.toggle("dark", resolveTheme({ preference, systemDark }) === "dark");
  window.frappeTheme = preference;
};
