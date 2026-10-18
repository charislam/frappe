import { mounting, provideContext } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { Effect, Exit, Layer, Option, Scope } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { QueryDemoSession } from "./context";
import { QueryExample } from "./example";
import { QueryDemoData, queryDemoResources } from "./resources";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

it("shares conversation data, browses inbox pages, filters results, and refreshes", async () => {
  const scope = await Effect.runPromise(Scope.make());
  cleanups.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const reads: string[] = [];
  const resources = Layer.effect(
    QueryDemoData,
    Effect.gen(function* () {
      const data = yield* QueryDemoData;
      return QueryDemoData.of({
        ...data,
        ticket: (id) => Effect.sync(() => reads.push(id)).pipe(Effect.andThen(data.ticket(id))),
      });
    }),
  ).pipe(Layer.provide(queryDemoResources));
  const app = await Effect.runPromise(
    mounting({
      scope,
      resources,
      onError: (failure) => {
        throw failure;
      },
    }),
  );
  const partition = await Effect.runPromise(app.signal({ initial: Option.some("support") }));
  await Effect.runPromise(Query.configure({ context: app, partition }));
  const parent = document.createElement("div");
  Effect.runSync(
    app.h(parent, provideContext({ key: QueryDemoSession, value: partition, child: QueryExample })),
  );
  const shows = (text: string) =>
    vi.waitFor(() => expect(parent.textContent).toContain(text), { timeout: 2000 });
  const press = (label: string) => {
    const button = [...parent.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(label),
    );
    expect(button).toBeDefined();
    button?.click();
  };
  await shows("maya@studiofield.example");
  await shows("Page 1 of 2");
  expect(reads).toEqual(["1042"]);
  expect(parent.querySelector<HTMLButtonElement>("nav button")?.disabled).toBe(true);
  press("Next");
  await shows("Page 2 of 2");
  await shows("Can we change our workspace name?");
  press("Can we change our workspace name?");
  await shows("nina@woven.example");
  expect(parent.querySelector('[aria-label="Conversation"]')?.textContent).toContain(
    "We’ve just rebranded",
  );
  expect(reads).toEqual(["1042", "1038"]);
  press("Refresh conversation");
  await vi.waitFor(() => expect(reads).toEqual(["1042", "1038", "1038"]));
  await shows("nina@woven.example");
  const filter = Option.getOrThrow(
    Option.fromNullishOr(parent.querySelector<HTMLSelectElement>("select")),
  );
  filter.value = "Resolved";
  filter.dispatchEvent(new Event("change", { bubbles: true }));
  await shows("2 conversations");
  await shows("Page 1 of 1");
  expect(parent.querySelectorAll(".dispatch-inbox li")).toHaveLength(2);
  const search = Option.getOrThrow(
    Option.fromNullishOr(parent.querySelector<HTMLInputElement>('input[type="search"]')),
  );
  search.value = "no matching conversation";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await shows("No conversations match your search.");
  expect(parent.querySelectorAll(".dispatch-inbox li")).toHaveLength(0);
});
