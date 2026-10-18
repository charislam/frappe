import { Sync, type SynchronousContext } from "@charismaticalli/frappe";
import { link } from "@charismaticalli/frappe/router";
import { type Effect, Option } from "effect";
import { Navigation } from "./context";
import { type Destination, urls } from "./routes";

export const button = <A, E, R>(
  context: SynchronousContext,
  options: { readonly label: string; readonly action: Effect.Effect<A, E, R> },
) =>
  Sync.gen(function* () {
    const node = yield* context.he("button", {
      props: { type: "button" },
      children: [options.label],
    });
    yield* context.subscribe(yield* context.events(node, "click"), () => options.action);
    return node;
  });

export const routeLink = (
  context: SynchronousContext,
  options: { readonly label: string; readonly destination: Destination },
) =>
  Sync.gen(function* () {
    const navigator = yield* Sync.service(Navigation);
    return yield* link({
      context,
      router: urls,
      navigator,
      destination: options.destination,
      children: [options.label],
    });
  });

export const workspaceNote = (context: SynchronousContext) =>
  Sync.gen(function* () {
    const note = yield* context.signal({ initial: "" });
    const input = yield* context.he("input", {
      attrs: { "aria-label": Option.some("Workspace note") },
      props: { type: "text", placeholder: "A reminder for this session" },
    });
    yield* context.bindValue({ element: input, signal: note });
    return yield* context.he("label", {
      attrs: { class: Option.some("routing-workspace-note") },
      children: ["Workspace note", input],
    });
  });

export const message = (context: SynchronousContext, text: string) =>
  context.he("p", { attrs: { role: Option.some("status") }, children: [text] });
