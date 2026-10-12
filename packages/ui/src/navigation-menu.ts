import {
  type ElementOutput,
  ReactiveError,
  Sync,
  type SynchronousContext,
  nativeNode,
  occurrenceId,
  readonlySignal,
} from "@charismaticalli/frappe";
import { Effect, Match, Option, Result } from "effect";

export type CloseReason =
  | { readonly _tag: "Trigger" }
  | { readonly _tag: "Escape" }
  | { readonly _tag: "OutsidePointer" }
  | { readonly _tag: "FocusOutside" }
  | { readonly _tag: "Selection" }
  | { readonly _tag: "Programmatic" };

const validate = (valid: boolean, message: string) =>
  Match.value(valid).pipe(
    Match.when(true, () => Sync.succeed(undefined)),
    Match.when(false, () => Sync.fail(new ReactiveError({ message }))),
    Match.exhaustive,
  );

const stateOf = (open: boolean) =>
  Match.value(open).pipe(
    Match.when(true, () => "open"),
    Match.when(false, () => "closed"),
    Match.exhaustive,
  );

/**
 * Headless disclosure for a navigation menu that collapses behind a trigger on small screens.
 * It never hides the menu itself: it exposes `aria-expanded`, `aria-controls` and a
 * `data-state` of "open" | "closed" on both the trigger and the menu so that styling can
 * decide when the menu is collapsible.
 */
export const make = (options: {
  readonly context: SynchronousContext;
  readonly initialOpen: boolean;
}) =>
  Sync.gen(function* () {
    const { context } = options;
    const state = yield* context.signal({ initial: options.initialOpen });
    let active = true;
    let binding: Option.Option<{ trigger: HTMLButtonElement; menu: HTMLElement }> = Option.none();
    const isOpen = () => context.readCommitted(state).pipe(Result.getOrElse(() => false));
    yield* context.addSyncFinalizer(() => {
      active = false;
      binding = Option.none();
      return undefined;
    });
    const close = ({ reason }: { readonly reason: CloseReason }) =>
      Effect.gen(function* () {
        const wasOpen = yield* state.get;
        const restore =
          wasOpen &&
          Match.value(reason._tag).pipe(
            Match.when("Escape", () => true),
            Match.when("Programmatic", () =>
              Option.exists(binding, ({ menu }) => menu.contains(menu.ownerDocument.activeElement)),
            ),
            Match.when("Trigger", () => false),
            Match.when("OutsidePointer", () => false),
            Match.when("FocusOutside", () => false),
            Match.when("Selection", () => false),
            Match.exhaustive,
          );
        yield* state.set(false);
        yield* Effect.sync(() =>
          Option.map(binding, ({ trigger }) =>
            Match.value(restore && trigger.isConnected && active).pipe(
              Match.when(true, () => trigger.focus()),
              Match.orElse(() => {}),
            ),
          ),
        );
      });
    const toggle = () =>
      state.get.pipe(
        Effect.flatMap((open) =>
          Match.value(open).pipe(
            Match.when(true, () => close({ reason: { _tag: "Trigger" } })),
            Match.when(false, () => state.set(true)),
            Match.exhaustive,
          ),
        ),
      );
    const attach = (elements: {
      readonly trigger: ElementOutput<HTMLButtonElement, unknown>;
      readonly menu: ElementOutput<HTMLElement, unknown>;
    }) =>
      Sync.gen(function* () {
        const trigger = nativeNode(elements.trigger);
        const menu = nativeNode(elements.menu);
        yield* validate(Option.isNone(binding), "NavigationMenu supports only one attachment");
        yield* context.bind({ element: elements.trigger });
        yield* context.bind({ element: elements.menu });
        yield* validate(
          trigger.tagName === "BUTTON" && trigger.ownerDocument === menu.ownerDocument,
          "NavigationMenu requires a button and menu in the same document",
        );
        const id = Match.value(menu.id.length > 0 && !/\s/u.test(menu.id)).pipe(
          Match.when(true, () => menu.id),
          Match.when(false, () => occurrenceId("navigation-menu")),
          Match.exhaustive,
        );
        const expanded = yield* context.derive({
          sources: { state },
          compute: ({ state }) => Option.some(String(state)),
        });
        const dataState = yield* context.derive({
          sources: { state },
          compute: ({ state }) => Option.some(stateOf(state)),
        });
        yield* context.bind({
          element: elements.trigger,
          attrs: {
            "aria-expanded": expanded,
            "aria-controls": Option.some(id),
            "data-state": dataState,
          },
        });
        yield* context.bind({
          element: elements.menu,
          attrs: { id: Option.some(id), "data-state": dataState },
        });
        binding = Option.some({ trigger, menu });
        yield* context.subscribe(yield* context.events(elements.trigger, "click"), toggle);
        yield* context.subscribe(yield* context.events(elements.menu, "click"), (event) =>
          Match.value(event.target instanceof Element && event.target.closest("a") !== null).pipe(
            Match.when(true, () => close({ reason: { _tag: "Selection" } })),
            Match.orElse(() => Effect.void),
          ),
        );
        const inside = (event: Event) =>
          event.composedPath().some((node) => node === trigger || node === menu);
        const document = trigger.ownerDocument;
        // Event paths are transient: decide outside-ness during native dispatch.
        for (const input of [
          { name: "pointerdown" as const, reason: { _tag: "OutsidePointer" as const } },
          { name: "focusin" as const, reason: { _tag: "FocusOutside" as const } },
        ]) {
          const outside = new WeakSet<Event>();
          yield* context.subscribe(
            yield* context.events(document, input.name, {
              capture: true,
              synchronous: (event) => {
                Match.value(isOpen() && !inside(event)).pipe(
                  Match.when(true, () => {
                    outside.add(event);
                  }),
                  Match.orElse(() => {}),
                );
              },
            }),
            (event) =>
              Match.value(outside.has(event)).pipe(
                Match.when(true, () => close({ reason: input.reason })),
                Match.orElse(() => Effect.void),
              ),
          );
        }
        for (const element of [elements.trigger, elements.menu]) {
          const handled = new WeakSet<KeyboardEvent>();
          yield* context.subscribe(
            yield* context.events(element, "keydown", {
              synchronous: (event) => {
                Match.value(event.key === "Escape" && isOpen() && !event.defaultPrevented).pipe(
                  Match.when(true, () => {
                    event.preventDefault();
                    event.stopPropagation();
                    handled.add(event);
                  }),
                  Match.orElse(() => {}),
                );
              },
            }),
            (event) =>
              Match.value(handled.has(event)).pipe(
                Match.when(true, () => close({ reason: { _tag: "Escape" } })),
                Match.orElse(() => Effect.void),
              ),
          );
        }
      });
    return { isOpen: readonlySignal(state), open: () => state.set(true), close, toggle, attach };
  });
