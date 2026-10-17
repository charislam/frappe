import {
  type ComponentContext,
  Context,
  type Signal,
  readonlySignal,
} from "@charismaticalli/frappe";
import { Effect, Match, Option, Queue } from "effect";
import { LocalStorage, storageDiagnostic } from "~/local-storage";
import { type ThemeBrowser } from "./browser";
import { type Preference, decodePreference, resolveTheme, storageKey } from "./model";

type Event = { preference: Option.Option<Preference>; persist: boolean };
export class Theme extends Context.Service<
  Theme,
  {
    readonly preference: Signal<Preference>;
    readonly select: (selection: { preference: Preference }) => Effect.Effect<void>;
  }
>()("site/Theme") {}
export const makeTheme = Effect.fn("Theme.make")(function* (options: {
  context: ComponentContext;
  browser: ThemeBrowser;
  startup: Option.Option<Preference>;
}) {
  const { context, browser } = options;
  const storage = yield* LocalStorage;
  let current = Option.getOrElse(options.startup, () => "system" as const);
  const preference = yield* context.signal({ initial: current });
  const events = yield* Queue.unbounded<Event>();
  const writes = yield* Queue.unbounded<Preference>();
  const apply = Effect.fn("Theme.apply")(function* (event: Event) {
    current = Option.getOrElse(event.preference, () => current);
    yield* preference.set(current);
    browser.project(resolveTheme({ preference: current, systemDark: browser.systemDark() }));
    yield* Match.value(event.persist).pipe(
      Match.when(true, () => Queue.offer(writes, current).pipe(Effect.asVoid)),
      Match.when(false, () => Effect.void),
      Match.exhaustive,
    );
  });
  const dispose = browser.observe((value) => {
    Queue.offerUnsafe(events, { preference: value, persist: false });
  });
  yield* context.addFinalizer(Effect.sync(dispose));
  current = yield* storage.get(storageKey).pipe(
    Effect.map((saved) =>
      Match.value(!storage.persistent && Option.isNone(saved)).pipe(
        Match.when(true, () => current),
        Match.when(false, () => decodePreference(Option.getOrNull(saved))),
        Match.exhaustive,
      ),
    ),
    Effect.catch(() => storageDiagnostic().pipe(Effect.as(current))),
  );
  yield* apply({ preference: Option.some(current), persist: false });
  yield* context.fork(
    Effect.forever(
      Queue.take(writes).pipe(
        Effect.flatMap((value) =>
          storage.set({ key: storageKey, value }).pipe(Effect.catch(storageDiagnostic)),
        ),
      ),
    ),
  );
  yield* context.fork(Effect.forever(Queue.take(events).pipe(Effect.flatMap(apply))));
  return Theme.of({
    preference: readonlySignal(preference),
    select: Effect.fn("Theme.select")(({ preference }: { preference: Preference }) =>
      Queue.offer(events, {
        preference: Option.some(decodePreference(preference)),
        persist: true,
      }).pipe(Effect.asVoid),
    ),
  });
});
