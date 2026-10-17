import { Resource } from "@charismaticalli/frappe";
import { Effect, Layer, Option } from "effect";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import type { KeyValueStoreError } from "effect/unstable/persistence/KeyValueStore";

export class LocalStorage extends Resource.Service<
  LocalStorage,
  {
    readonly persistent: boolean;
    readonly get: (key: string) => Effect.Effect<Option.Option<string>, KeyValueStoreError>;
    readonly set: (entry: {
      readonly key: string;
      readonly value: string;
    }) => Effect.Effect<void, KeyValueStoreError>;
  }
>()("frappe/LocalStorage") {}

export const storageDiagnostic = () =>
  Effect.sync(() => console.warn("Browser storage unavailable; preferences may not persist."));

const adapter = (persistent: boolean) =>
  Layer.effect(
    LocalStorage,
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      return LocalStorage.of({
        persistent,
        get: Effect.fn("LocalStorage.get")((key: string) =>
          store.get(key).pipe(Effect.map(Option.fromUndefinedOr)),
        ),
        set: Effect.fn("LocalStorage.set")(
          ({ key, value }: { readonly key: string; readonly value: string }) =>
            store.set(key, value),
        ),
      });
    }),
  );
export const browserStorageLayer = (acquire: () => Storage) =>
  Layer.unwrap(
    Effect.try(acquire).pipe(
      Effect.map((storage) =>
        adapter(true).pipe(Layer.provide(KeyValueStore.layerStorage(() => storage))),
      ),
      Effect.catch(() => storageDiagnostic().pipe(Effect.as(LocalStorageMemory))),
    ),
  );
export const LocalStorageMemory = adapter(false).pipe(Layer.provide(KeyValueStore.layerMemory));
export const LocalStorageLive = browserStorageLayer(() => window.localStorage);
