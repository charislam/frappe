import { Deferred, Effect, Fiber, Option } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { supabaseClient } from "~/auth/supabase";
import { BudgetId } from "./model";
import { makeBudgets } from "./service";
const config = { url: "http://budgie.example", key: "test-publishable-key" };
const setup = () => {
  const client = supabaseClient(config);
  vi.spyOn(client.auth, "getSession").mockResolvedValue({
    data: {
      session: {
        access_token: "test-access-token",
        refresh_token: "refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: {
          id: "A",
          aud: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      },
    },
    error: null,
  });
  return makeBudgets(client);
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("preserves SDK error status and uses SDK authentication and query construction", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  const service = setup();
  const failure = await Effect.runPromise(
    service.list.load({ userId: "A", cursor: Option.none() }).pipe(Effect.flip),
  );
  expect(failure).toMatchObject({ _tag: "BudgetError", status: Option.some(403) });
  expect(service.list.retry._tag).toBe("Disabled");
  expect(new Headers(fetcher.mock.calls[0]?.[1].headers).get("Authorization")).toBe(
    "Bearer test-access-token",
  );
  const url = new URL(fetcher.mock.calls[0]?.[0]);
  expect(url.pathname).toBe("/rest/v1/budgets");
  expect(url.searchParams.get("order")).toBe("created_at.asc,id.asc");
  expect(url.searchParams.get("archived_at")).toBe("is.null");
  expect(url.searchParams.get("limit")).toBe("51");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("lets the SDK retry transient reads", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const result = Effect.runPromise(setup().list.load({ userId: "A", cursor: Option.none() }));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toEqual({ budgets: [], next: Option.none() });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("represents SDK network failures as typed errors and never retries creation", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Network failed"));
  vi.stubGlobal("fetch", fetcher);
  const service = setup();
  const failure = await Effect.runPromise(
    service.create({ id: BudgetId.make(crypto.randomUUID()), name: "Trip" }).pipe(Effect.flip),
  );
  expect(failure).toMatchObject({ _tag: "BudgetError", status: Option.some(0) });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const validation = await Effect.runPromise(
    service.create({ id: BudgetId.make(crypto.randomUUID()), name: " " }).pipe(Effect.flip),
  );
  expect(validation._tag).toBe("InvalidBudgetName");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("interrupts an in-flight fetch", async () => {
  let aborted = false;
  const entered = Deferred.makeUnsafe<void>();
  vi.stubGlobal(
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
        Effect.runSync(Deferred.succeed(entered, undefined));
      }),
  );
  const fiber = Effect.runFork(setup().list.load({ userId: "A", cursor: Option.none() }));
  await Effect.runPromise(Deferred.await(entered));
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(aborted).toBe(true);
});
it("returns a single cursor page using the full timestamp and ID tie-breaker", async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `Budget ${index}`,
    created_at: "2026-01-01T00:00:00.123456+00:00",
    archived_at: null,
  }));
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(rows)))
    .mockResolvedValueOnce(new Response("[]"));
  vi.stubGlobal("fetch", fetcher);
  const service = setup();
  const first = await Effect.runPromise(service.list.load({ userId: "A", cursor: Option.none() }));
  expect(first.budgets).toHaveLength(50);
  expect(first.next).toEqual(
    Option.some({ created_at_raw: "2026-01-01T00:00:00.123456+00:00", id: rows[49]?.id }),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const second = await Effect.runPromise(service.list.load({ userId: "A", cursor: first.next }));
  const url = new URL(fetcher.mock.calls[1]?.[0]);
  expect(url.searchParams.get("or")).toBe(
    `(created_at.gt.2026-01-01T00:00:00.123456+00:00,and(created_at.eq.2026-01-01T00:00:00.123456+00:00,id.gt.${rows[49]?.id}))`,
  );
  expect(second.next).toEqual(Option.none());
});
