import { Resource } from "@charismaticalli/frappe";
import { Effect, Layer, Option } from "effect";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import type { KeyValueStoreError } from "effect/unstable/persistence/KeyValueStore";
import { acquireStorage } from "./storage";

/** Operations must complete synchronously, matching Web Storage and the memory adapter. */
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
export const LocalStorageMemory = adapter(false).pipe(Layer.provide(KeyValueStore.layerMemory));
export const browserStorageLayer = (acquire: () => Storage) =>
  Layer.unwrap(
    acquireStorage(acquire).pipe(
      Effect.map((storage) =>
        Option.match(storage, {
          onSome: (storage) =>
            adapter(true).pipe(Layer.provide(KeyValueStore.layerStorage(() => storage))),
          onNone: () => LocalStorageMemory,
        }),
      ),
    ),
  );
export const LocalStorageLive = browserStorageLayer(() => window.localStorage);
export { storageDiagnostic } from "./storage";
