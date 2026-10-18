import { Resource } from "@charismaticalli/frappe";
import { Effect, Layer, Option, Schema } from "effect";

export interface Ticket {
  readonly id: string;
  readonly subject: string;
  readonly customer: string;
  readonly email: string;
  readonly company: string;
  readonly status: "Open" | "Resolved";
  readonly received: string;
  readonly message: string;
  readonly reply: string;
}
export interface InboxInput {
  readonly search: string;
  readonly status: string;
  readonly page: number;
  readonly session: string;
}
export interface InboxPage {
  readonly tickets: ReadonlyArray<Ticket>;
  readonly page: number;
  readonly pages: number;
  readonly total: number;
}
const tickets: ReadonlyArray<Ticket> = [
  {
    id: "1042",
    subject: "Help inviting my team",
    customer: "Maya Chen",
    email: "maya@studiofield.example",
    company: "Studio Field",
    status: "Open",
    received: "9:42 AM",
    message:
      "Hi! We’re moving our design team over this week. Can I invite everyone at once, or do I need to send individual invitations? We have about 20 people joining.",
    reply:
      "Hi Maya, welcome aboard! You can invite your whole team from Settings → Members. Paste their email addresses separated by commas and we’ll send each person an invitation.",
  },
  {
    id: "1041",
    subject: "A copy of our latest invoice",
    customer: "Oliver Park",
    email: "oliver@northstar.example",
    company: "Northstar",
    status: "Open",
    received: "9:18 AM",
    message:
      "Could you help me find a PDF of our most recent invoice? Our finance team needs it for their monthly reconciliation.",
    reply:
      "Hi Oliver! Your invoices are available in Settings → Billing → Invoice history. Select the latest invoice to download a PDF.",
  },
  {
    id: "1040",
    subject: "Setting up a shared workspace",
    customer: "Amara Okafor",
    email: "amara@common.example",
    company: "Common Ground",
    status: "Open",
    received: "Yesterday",
    message:
      "We work across two offices. What’s the best way to organize projects so both teams can see what’s happening?",
    reply:
      "Hi Amara! A shared workspace is a great fit. Create a team for each office, then add both teams to any projects you collaborate on.",
  },
  {
    id: "1039",
    subject: "Thanks for the export help",
    customer: "Leo Martin",
    email: "leo@form.example",
    company: "Form & Co.",
    status: "Resolved",
    received: "Yesterday",
    message: "The CSV export worked perfectly. Thanks for walking me through it!",
    reply: "Glad to hear it, Leo. Just let us know if there’s anything else we can help with.",
  },
  {
    id: "1038",
    subject: "Can we change our workspace name?",
    customer: "Nina Patel",
    email: "nina@woven.example",
    company: "Woven",
    status: "Open",
    received: "Monday",
    message:
      "We’ve just rebranded and would like to update the name everyone sees in our workspace. Will this affect our existing projects?",
    reply:
      "Hi Nina, congratulations on the rebrand! An admin can change the workspace name in Settings → General. All your projects and links will keep working.",
  },
  {
    id: "1037",
    subject: "Notifications are working again",
    customer: "Sam Rivera",
    email: "sam@bright.example",
    company: "Bright Studio",
    status: "Resolved",
    received: "Monday",
    message:
      "Updating my notification preferences did the trick. I’m receiving the daily summary now.",
    reply:
      "Wonderful, Sam! You can adjust the summary schedule from your profile whenever you need to.",
  },
];
export class DemoFailure extends Schema.TaggedError<DemoFailure>()("QueryDemoFailure", {
  message: Schema.String,
}) {}
export class QueryDemoData extends Resource.Service<
  QueryDemoData,
  {
    readonly ticket: (id: string) => Effect.Effect<Ticket, DemoFailure>;
    readonly inbox: (input: InboxInput) => Effect.Effect<InboxPage>;
  }
>()("QueryDemoData") {}
export const queryDemoResources = Layer.succeed(
  QueryDemoData,
  QueryDemoData.of({
    ticket: Effect.fn("Dispatch.ticket")(function* (id: string) {
      yield* Effect.sleep("150 millis");
      return yield* Option.match(
        Option.fromUndefinedOr(tickets.find((ticket) => ticket.id === id)),
        {
          onNone: () =>
            Effect.fail(new DemoFailure({ message: "This conversation is no longer available." })),
          onSome: Effect.succeed,
        },
      );
    }),
    inbox: Effect.fn("Dispatch.inbox")(function* (input: InboxInput) {
      yield* Effect.sleep("150 millis");
      const search = input.search.trim().toLowerCase();
      const matches = tickets.filter(
        (ticket) =>
          (input.status === "All" || ticket.status === input.status) &&
          `${ticket.subject} ${ticket.customer} ${ticket.company} ${ticket.message}`
            .toLowerCase()
            .includes(search),
      );
      const pages = Math.max(1, Math.ceil(matches.length / 3));
      const page = Math.max(1, Math.min(input.page, pages));
      return {
        tickets: matches.slice((page - 1) * 3, page * 3),
        page,
        pages,
        total: matches.length,
      };
    }),
  }),
);
