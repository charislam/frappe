import { Resource } from "@charismaticalli/frappe";
import { Effect, Layer, Match, Option, Schema, Semaphore } from "effect";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import { BudgetId } from "./model";

export const privatePrefix = "budgie.preferences.";
const selectedBudgetPreference = "selected_budget";
export const selectedBudgetStorageKey = `${privatePrefix}${selectedBudgetPreference}`;
export const privateStorage = (storage: () => Storage): Storage => ({
  get length() {
    return storage().length;
  },
  key: (index) => storage().key(index),
  getItem: (key) => storage().getItem(key),
  setItem: (key, value) => storage().setItem(key, value),
  removeItem: (key) => storage().removeItem(key),
  clear: () => {
    const target = storage();
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index));
    for (const key of keys) {
      Match.value(key).pipe(
        Match.when(
          (key): key is string => key !== null && key.startsWith(privatePrefix),
          (key) => target.removeItem(key),
        ),
        Match.orElse(() => {}),
      );
    }
  },
});
export const makePreferences = Effect.gen(function* () {
  const raw = yield* KeyValueStore.KeyValueStore;
  const store = KeyValueStore.prefix(raw, privatePrefix);
  const lock = yield* Semaphore.make(1);
  let user = Option.none<string>();
  let epoch = 0;
  const clear = lock.withPermits(1)(
    Effect.gen(function* () {
      epoch += 1;
      user = Option.none();
      yield* raw.clear.pipe(Effect.ignore);
    }),
  );
  return {
    clear,
    identify: (next: Option.Option<string>) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          yield* Match.value(
            Option.exists(user, (current) => !Option.contains(next, current)),
          ).pipe(
            Match.when(true, () =>
              Effect.gen(function* () {
                epoch += 1;
                yield* raw.clear.pipe(Effect.ignore);
              }),
            ),
            Match.orElse(() => Effect.void),
          );
          user = next;
        }),
      ),
    session: (id: string) =>
      Effect.sync(() => {
        const generation = epoch;
        const valid = () => generation === epoch && Option.contains(user, id);
        const guard = <A>(work: Effect.Effect<A>, fallback: A) =>
          lock.withPermits(1)(
            Effect.suspend(() =>
              Match.value(valid()).pipe(
                Match.when(true, () => work),
                Match.orElse(() => Effect.succeed(fallback)),
              ),
            ),
          );
        return {
          read: guard(
            store.get(selectedBudgetPreference).pipe(
              Effect.flatMap((value) =>
                Option.match(Option.fromUndefinedOr(value), {
                  onNone: () => Effect.succeed(Option.none<BudgetId>()),
                  onSome: (value) =>
                    Schema.decodeUnknownEffect(BudgetId)(value).pipe(
                      Effect.map(Option.some),
                      Effect.catch(() =>
                        store
                          .remove(selectedBudgetPreference)
                          .pipe(Effect.ignore, Effect.as(Option.none<BudgetId>())),
                      ),
                    ),
                }),
              ),
              Effect.catch(() => Effect.succeed(Option.none<BudgetId>())),
            ),
            Option.none<BudgetId>(),
          ),
          save: (id: BudgetId) =>
            guard(store.set(selectedBudgetPreference, id).pipe(Effect.ignore), undefined),
          remove: guard(store.remove(selectedBudgetPreference).pipe(Effect.ignore), undefined),
        };
      }),
  };
});
export class Preferences extends Resource.Service<
  Preferences,
  Effect.Success<typeof makePreferences>
>()("budgie/Preferences") {}
export const preferencesLayer = (storage: () => Storage) =>
  Layer.effect(Preferences, makePreferences).pipe(
    Layer.provide(KeyValueStore.layerStorage(() => privateStorage(storage))),
  );
