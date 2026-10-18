import { type Signal, Sync, component } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { QueryState } from "@charismaticalli/frappe/query";
import { Effect, Match, Option } from "effect";
import { type TicketInput, TicketQuery } from "./queries";
import type { Ticket } from "./resources";
import { queryValue } from "./state";

export const Conversation = (options: {
  input: Signal<Option.Option<TicketInput>>;
  customerOnly: boolean;
}) =>
  component(() =>
    Sync.succeed({
      setup: (ui) =>
        Effect.gen(function* () {
          const ticket = yield* Query.observe({
            context: ui,
            query: TicketQuery,
            input: options.input,
          });
          const field = (read: (ticket: Ticket) => string) =>
            ui.derive({
              sources: { state: ticket.state },
              compute: ({ state }) =>
                Option.match(queryValue(state), { onNone: () => "", onSome: read }),
            });
          const status = yield* ui.derive({
            sources: { state: ticket.state },
            compute: ({ state }) =>
              QueryState.match(state, {
                onInitial: () => "Loading conversation…",
                onSuccess: (state) =>
                  Match.value(state.waiting).pipe(
                    Match.when(true, () => "Updating conversation…"),
                    Match.orElse(() => ""),
                  ),
                onFailure: () => "We couldn’t load this conversation. Try refreshing.",
              }),
          });
          const customer = yield* field((ticket) => ticket.customer);
          const content = yield* Match.value(options.customerOnly).pipe(
            Match.when(true, () =>
              Effect.gen(function* () {
                return [
                  yield* ui.he("h3", { children: ["Customer details"] }),
                  yield* ui.he("strong", { children: [customer] }),
                  yield* ui.he("p", { children: [yield* field((ticket) => ticket.email)] }),
                  yield* ui.he("p", { children: [yield* field((ticket) => ticket.company)] }),
                  yield* ui.he("small", {
                    children: [
                      yield* field((ticket) => `Conversation #${ticket.id} · ${ticket.status}`),
                    ],
                  }),
                ];
              }),
            ),
            Match.orElse(() =>
              Effect.gen(function* () {
                const refresh = yield* ui.he("button", {
                  props: { type: "button" },
                  children: ["Refresh conversation"],
                });
                yield* ui.subscribe(yield* ui.events(refresh, "click"), () => ticket.refresh);
                return [
                  yield* ui.he("header", {
                    children: [
                      yield* ui.he("h3", { children: [yield* field((ticket) => ticket.subject)] }),
                      refresh,
                    ],
                  }),
                  yield* ui.he("p", { attrs: { role: Option.some("status") }, children: [status] }),
                  yield* ui.he("article", {
                    children: [
                      yield* ui.he("strong", { children: [customer] }),
                      yield* ui.he("p", { children: [yield* field((ticket) => ticket.message)] }),
                    ],
                  }),
                  yield* ui.he("article", {
                    attrs: { class: Option.some("dispatch-reply") },
                    children: [
                      yield* ui.he("strong", { children: ["You · Support team"] }),
                      yield* ui.he("p", { children: [yield* field((ticket) => ticket.reply)] }),
                    ],
                  }),
                  yield* ui.he("small", {
                    children: ["Demo inbox · conversations use sample data."],
                  }),
                ];
              }),
            ),
          );
          return yield* ui.he("section", {
            attrs: {
              class: Option.some(
                Match.value(options.customerOnly).pipe(
                  Match.when(true, () => "dispatch-customer"),
                  Match.orElse(() => "dispatch-conversation"),
                ),
              ),
              "aria-label": Option.some(
                Match.value(options.customerOnly).pipe(
                  Match.when(true, () => "Customer details"),
                  Match.orElse(() => "Conversation"),
                ),
              ),
            },
            children: content,
          });
        }),
    }),
  );
