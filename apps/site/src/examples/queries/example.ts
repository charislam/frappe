import { Sync, component, keyed, nativeNode, row } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { QueryState } from "@charismaticalli/frappe/query";
import { Effect, Match, Option } from "effect";
import { QueryDemoSession } from "./context";
import { Conversation } from "./conversation";
import { InboxQuery } from "./queries";
import type { Ticket } from "./resources";
import { queryValue } from "./state";

export const QueryExample = component(() =>
  Sync.succeed({
    setup: (ui) =>
      Effect.gen(function* () {
        const session = yield* QueryDemoSession;
        const selected = yield* ui.signal({ initial: "1042" });
        const search = yield* ui.signal({ initial: "" });
        const status = yield* ui.signal({ initial: "All" });
        const page = yield* ui.signal({ initial: 1 });
        const input = yield* ui.derive({
          sources: { selected, session },
          compute: ({ selected, session }) =>
            Option.map(session, (session) => ({ id: selected, session })),
        });
        const inboxInput = yield* ui.derive({
          sources: { search, status, page, session },
          compute: ({ search, status, page, session }) =>
            Option.map(session, (session) => ({ search, status, page, session })),
        });
        const inbox = yield* Query.observe({
          context: ui,
          query: InboxQuery,
          input: inboxInput,
          retainPrevious: true,
        });
        const items = yield* ui.derive({
          sources: { state: inbox.state },
          compute: ({ state }) =>
            Option.match(queryValue(state), { onNone: () => [], onSome: (data) => data.tickets }),
        });
        const waiting = yield* ui.derive({
          sources: { state: inbox.state },
          compute: ({ state }) => state.waiting,
        });
        const notice = yield* ui.derive({
          sources: { state: inbox.state },
          compute: ({ state }) =>
            QueryState.match(state, {
              onInitial: () => "Loading your inbox…",
              onSuccess: (state) =>
                Match.value(state.waiting).pipe(
                  Match.when(true, () => "Updating inbox…"),
                  Match.orElse(() =>
                    Match.value(state.value.total === 0).pipe(
                      Match.when(true, () => "No conversations match your search."),
                      Match.orElse(() => `${state.value.total} conversations`),
                    ),
                  ),
                ),
              onFailure: () => "We couldn’t load your inbox. Try refreshing.",
            }),
        });
        const pageLabel = yield* ui.derive({
          sources: { state: inbox.state },
          compute: ({ state }) =>
            Option.match(queryValue(state), {
              onNone: () => "Page 1 of 1",
              onSome: (data) => `Page ${data.page} of ${data.pages}`,
            }),
        });
        const previousDisabled = yield* ui.derive({
          sources: { state: inbox.state },
          compute: ({ state }) =>
            state.waiting ||
            Option.match(queryValue(state), {
              onNone: () => true,
              onSome: (data) => data.page <= 1,
            }),
        });
        const nextDisabled = yield* ui.derive({
          sources: { state: inbox.state },
          compute: ({ state }) =>
            state.waiting ||
            Option.match(queryValue(state), {
              onNone: () => true,
              onSome: (data) => data.page >= data.pages,
            }),
        });
        const TicketRow = row<Ticket>()(({ context, inputs }) =>
          Sync.gen(function* () {
            const subject = yield* context.derive({
              sources: { item: inputs.item },
              compute: ({ item }) => item.subject,
            });
            const preview = yield* context.derive({
              sources: { item: inputs.item },
              compute: ({ item }) => `${item.customer} · ${item.received}`,
            });
            const badge = yield* context.derive({
              sources: { item: inputs.item },
              compute: ({ item }) => item.status,
            });
            const pressed = yield* context.derive({
              sources: { selected },
              compute: ({ selected }) => Option.some(String(selected === inputs.key)),
            });
            const button = yield* context.he("button", {
              props: { type: "button" },
              attrs: { "aria-pressed": pressed },
              children: [
                yield* context.he("small", { children: [preview] }),
                yield* context.he("strong", { children: [subject] }),
                yield* context.he("span", { children: [badge] }),
              ],
            });
            yield* context.subscribe(yield* context.events(button, "click"), () =>
              selected.set(String(inputs.key)),
            );
            const output = yield* context.he("li", { children: [button] });
            return { setup: () => Effect.succeed(output) };
          }),
        );
        const searchBox = yield* ui.he("input", {
          props: { type: "search", placeholder: "Search conversations" },
          attrs: { "aria-label": Option.some("Search conversations") },
        });
        yield* ui.bindValue({ element: searchBox, signal: search });
        yield* ui.subscribe(yield* ui.events(searchBox, "input"), () => page.set(1));
        const filter = yield* ui.he("select", {
          attrs: { "aria-label": Option.some("Conversation status") },
          children: yield* Effect.forEach(["All", "Open", "Resolved"], (value) =>
            ui.he("option", { props: { value }, children: [value] }),
          ),
        });
        yield* ui.subscribe(yield* ui.events(filter, "change"), () =>
          status.set(nativeNode(filter).value).pipe(Effect.andThen(page.set(1))),
        );
        const previous = yield* ui.he("button", {
          props: { type: "button", disabled: previousDisabled },
          children: ["Previous"],
        });
        const next = yield* ui.he("button", {
          props: { type: "button", disabled: nextDisabled },
          children: ["Next"],
        });
        yield* ui.subscribe(yield* ui.events(previous, "click"), () =>
          page.update((page) => Math.max(1, page - 1)),
        );
        yield* ui.subscribe(yield* ui.events(next, "click"), () => page.update((page) => page + 1));
        const refresh = yield* ui.he("button", {
          props: { type: "button", disabled: waiting },
          children: ["Refresh inbox"],
        });
        yield* ui.subscribe(yield* ui.events(refresh, "click"), () => inbox.refresh);
        return yield* ui.he("section", {
          attrs: {
            class: Option.some("dispatch-page"),
            "aria-label": Option.some("Dispatch support inbox"),
          },
          children: [
            yield* ui.he("header", {
              children: [
                yield* ui.he("div", {
                  children: [
                    yield* ui.he("h2", { children: ["Dispatch"] }),
                    yield* ui.he("p", { children: ["A little more care in every conversation."] }),
                  ],
                }),
                yield* ui.he("small", { children: ["Support workspace · Ada"] }),
              ],
            }),
            yield* ui.he("div", {
              attrs: { class: Option.some("dispatch-layout") },
              children: [
                yield* ui.he("section", {
                  attrs: {
                    class: Option.some("dispatch-inbox"),
                    "aria-label": Option.some("Inbox"),
                  },
                  children: [
                    yield* ui.he("header", {
                      children: [yield* ui.he("h3", { children: ["Inbox"] }), refresh],
                    }),
                    searchBox,
                    filter,
                    yield* ui.he("p", {
                      attrs: { role: Option.some("status") },
                      children: [notice],
                    }),
                    yield* ui.he("ul", {
                      attrs: {
                        "aria-busy": yield* ui.derive({
                          sources: { waiting },
                          compute: ({ waiting }) => Option.some(String(waiting)),
                        }),
                      },
                      children: [keyed({ items, key: (item) => item.id, row: () => TicketRow })],
                    }),
                    yield* ui.he("nav", {
                      attrs: { "aria-label": Option.some("Inbox pages") },
                      children: [previous, yield* ui.he("small", { children: [pageLabel] }), next],
                    }),
                  ],
                }),
                Conversation({ input, customerOnly: false }),
                Conversation({ input, customerOnly: true }),
              ],
            }),
          ],
        });
      }),
  }),
);
