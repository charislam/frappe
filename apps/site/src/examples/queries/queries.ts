import * as Query from "@charismaticalli/frappe/query";
import { Effect, Schedule } from "effect";
import { type InboxInput, QueryDemoData } from "./resources";

export type TicketInput = { readonly id: string; readonly session: string };
export const TicketQuery = Query.define({
  name: "DispatchTicket",
  staleTime: "30 seconds",
  retry: Query.retry(Schedule.recurs(1)),
  load: (input: TicketInput) => QueryDemoData.pipe(Effect.flatMap((data) => data.ticket(input.id))),
});
export const InboxQuery = Query.define({
  name: "DispatchInbox",
  staleTime: "30 seconds",
  load: (input: InboxInput) => QueryDemoData.pipe(Effect.flatMap((data) => data.inbox(input))),
});
