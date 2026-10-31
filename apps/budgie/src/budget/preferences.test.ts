// @vitest-environment happy-dom
import { Deferred, Effect, Fiber, Option } from "effect";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { BudgetId } from "./model";
import {
  makePreferences,
  Preferences,
  preferencesLayer,
  selectedBudgetStorageKey,
} from "./preferences";
const run = Effect.runPromise;
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it("uses a single namespaced key and silently tolerates storage failures", async () => {
  await run(
    Effect.gen(function* () {
      const prefs = yield* Preferences;
      yield* prefs.identify(Option.some("A"));
      const session = yield* prefs.session("A");
      expectTypeOf(yield* session.read).toEqualTypeOf<Option.Option<BudgetId>>();
      expect(yield* session.read).toEqual(Option.none());
      localStorage.setItem(selectedBudgetStorageKey, "");
      expect(yield* session.read).toEqual(Option.none());
      expect(localStorage.getItem(selectedBudgetStorageKey)).toBeNull();
      yield* session.save(BudgetId.make("budget-a"));
      expect(localStorage.getItem(selectedBudgetStorageKey)).toBe("budget-a");
      expect(yield* session.read).toEqual(Option.some("budget-a"));
      const getter = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
      expect(yield* session.read).toEqual(Option.none());
      getter.mockRestore();
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("Storage full");
      });
      yield* session.save(BudgetId.make("budget-b"));
      vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
      yield* prefs.clear;
      // Clear failure still retires the old session in memory.
      expect(yield* session.read).toEqual(Option.none());
    }).pipe(Effect.provide(preferencesLayer(() => localStorage))),
  );
});
it("serializes logout behind pending writes and prevents a retired visit from writing again", async () => {
  await run(
    Effect.gen(function* () {
      const backing = yield* KeyValueStore.KeyValueStore;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const raw = {
        ...backing,
        set: (key: string, value: string | Uint8Array) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(backing.set(key, value)),
          ),
      };
      const prefs = yield* makePreferences.pipe(
        Effect.provideService(KeyValueStore.KeyValueStore, raw),
      );
      yield* prefs.identify(Option.some("A"));
      const session = yield* prefs.session("A");
      const write = yield* Effect.forkChild(session.save(BudgetId.make("a")));
      yield* Deferred.await(entered);
      const logout = yield* Effect.forkChild(prefs.clear);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(write);
      yield* Fiber.join(logout);
      yield* session.save(BudgetId.make("late"));
      expect(yield* backing.get(selectedBudgetStorageKey)).toBeUndefined();
      yield* prefs.identify(Option.some("A"));
      yield* session.save(BudgetId.make("old-same-user-session"));
      expect(yield* backing.get(selectedBudgetStorageKey)).toBeUndefined();
      const fresh = yield* prefs.session("A");
      yield* fresh.save(BudgetId.make("fresh"));
      expect(yield* fresh.read).toEqual(Option.some("fresh"));
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
  );
});
