import { Deferred, Effect, Exit, Result, Schema, SchemaGetter } from "effect";
import { describe, expect, it } from "vitest";
import { component, focus } from "./framework";
import * as Sync from "./sync";
import { harness, rendered } from "./test-helpers";
import { type ValidationHandle, attach, formatIssues, isValidated, match } from "./validation";

const run = Effect.runPromise;
describe("validation", () => {
  it("starts unvalidated, preserves raw text, clears and resets independently", async () => {
    const { ctx } = await harness();
    const source = await run(ctx.signal({ initial: "12" }));
    const field = await run(attach({ context: ctx, source, schema: Schema.FiniteFromString }));
    expect(await run(field.state.get)).toEqual({ _tag: "NotValidated", input: "12" });
    await run(field.validate());
    expect(await run(field.state.get)).toEqual({ _tag: "Validated", input: "12", value: 12 });
    await run(source.set("12"));
    expect(isValidated(await run(field.state.get))).toBe(true);
    await run(source.set("bad"));
    expect(await run(field.state.get)).toEqual({ _tag: "NotValidated", input: "bad" });
    await run(field.validate());
    expect((await run(field.state.get))._tag).toBe("Invalid");
    await run(field.clearValidation());
    expect(await run(source.get)).toBe("bad");
    await run(field.reset());
    await run(field.reset());
    expect(await run(source.get)).toBe("12");
    expect((await run(field.state.get))._tag).toBe("NotValidated");
    await run(field.validate());
    await run(field.reset());
    expect((await run(field.state.get))._tag).toBe("NotValidated");
  });

  it("reads staged input, invalidates synchronously, rolls back and coalesces", async () => {
    const { ctx } = await harness();
    const source = await run(ctx.signal({ initial: "1" }));
    const field = await run(attach({ context: ctx, source, schema: Schema.FiniteFromString }));
    await run(field.validate());
    await run(
      ctx.batch(
        Effect.gen(function* () {
          yield* source.set("2");
          expect((yield* field.state.get)._tag).toBe("NotValidated");
          yield* field.validate();
          expect(yield* field.state.get).toEqual({ _tag: "Validated", input: "2", value: 2 });
        }),
      ),
    );
    await run(ctx.batch(source.set("3").pipe(Effect.andThen(source.set("2")))));
    expect((await run(field.state.get))._tag).toBe("Validated");
    await run(
      ctx.batch(
        Effect.gen(function* () {
          yield* field.validate();
          yield* source.set("4");
          expect((yield* field.state.get)._tag).toBe("NotValidated");
        }),
      ),
    );
    expect((await run(field.state.get))._tag).toBe("NotValidated");
    await run(
      ctx
        .batch(
          source
            .set("5")
            .pipe(Effect.andThen(field.validate), Effect.andThen(Effect.fail("rollback"))),
        )
        .pipe(Effect.flip),
    );
    expect(await run(source.get)).toBe("4");
    expect((await run(field.state.get))._tag).toBe("NotValidated");
  });

  it("keeps attachments independent and rejects disposed and foreign owners", async () => {
    const { ctx, close } = await harness();
    const source = await run(ctx.signal({ initial: "1" }));
    const first = await run(attach({ context: ctx, source, schema: Schema.String }));
    const second = await run(attach({ context: ctx, source, schema: Schema.String }));
    await run(first.validate());
    await run(second.validate());
    await run(first.clearValidation());
    expect((await run(second.state.get))._tag).toBe("Validated");
    await run(source.set("2"));
    await run(first.reset());
    expect((await run(second.state.get))._tag).toBe("NotValidated");
    const foreign = await harness();
    expect(
      Result.isFailure(
        await run(
          attach({ context: foreign.ctx, source, schema: Schema.String }).pipe(Effect.result),
        ),
      ),
    ).toBe(true);
    await close();
    expect(Result.isFailure(await run(first.validate().pipe(Effect.result)))).toBe(true);
  });

  it("retains all issue paths and offers exhaustive state matching", async () => {
    const { ctx } = await harness();
    const source = await run(ctx.signal({ initial: { a: "x", b: "y" } }));
    const field = await run(
      attach({
        context: ctx,
        source,
        schema: Schema.Struct({ a: Schema.FiniteFromString, b: Schema.FiniteFromString }),
      }),
    );
    await run(field.validate());
    const paths = match(await run(field.state.get), {
      NotValidated: () => [],
      Validated: () => [],
      Invalid: ({ issue }) => formatIssues(issue).issues.map((issue) => issue.path),
    });
    expect(paths).toEqual([["a"], ["b"]]);
  });
});

it("rejects async execution and defects without publishing a field error", async () => {
  const { ctx } = await harness();
  const source = await run(ctx.signal({ initial: "secret" }));
  for (const decode of [
    SchemaGetter.transformEffect((s: string) => Effect.promise(() => Promise.resolve(s))),
    SchemaGetter.transformEffect(() => Effect.die("decoder defect")),
  ]) {
    const schema = Schema.String.pipe(
      Schema.decodeTo(Schema.String, { decode, encode: SchemaGetter.transform((s: string) => s) }),
    );
    const field = await run(attach({ context: ctx, source, schema }));
    expect(Exit.isFailure(await run(field.validate().pipe(Effect.exit)))).toBe(true);
    expect((await run(field.state.get))._tag).toBe("NotValidated");
  }
});

it("invalidates writable lenses only when their projection changes", async () => {
  const { ctx } = await harness();
  const parent = await run(ctx.signal({ initial: { name: "Alex", other: 0 } }));
  const source = await run(Sync.toEffect(focus({ context: ctx, source: parent, key: "name" })));
  const field = await run(attach({ context: ctx, source, schema: Schema.String }));
  await run(field.validate());
  await run(
    ctx.batch(
      Effect.gen(function* () {
        yield* field.validate();
        yield* parent.update((value) => ({ ...value, other: 1 }));
        expect((yield* field.state.get)._tag).toBe("Validated");
      }),
    ),
  );
  await run(parent.update((value) => ({ ...value, name: "Sam" })));
  expect(await run(field.state.get)).toEqual({ _tag: "NotValidated", input: "Sam" });
  await run(
    ctx.batch(
      Effect.gen(function* () {
        yield* field.validate();
        yield* source.set("Taylor");
        yield* source.set("Sam");
        expect((yield* field.state.get)._tag).toBe("NotValidated");
      }),
    ),
  );
  expect((await run(field.state.get))._tag).toBe("NotValidated");
});

it("reruns explicit validation and respects custom source equality", async () => {
  const { ctx } = await harness();
  let calls = 0;
  const source = await run(
    ctx.signal({
      initial: { name: "Alex" },
      equals: ({ previous, proposed }) => previous.name === proposed.name,
    }),
  );
  const schema = Schema.Struct({ name: Schema.String }).check(
    Schema.makeFilter(() => {
      calls += 1;
      return true;
    }),
  );
  const field = await run(attach({ context: ctx, source, schema }));
  expect(calls).toBe(0);
  await run(field.validate());
  await run(field.validate());
  expect(calls).toBe(2);
  await run(source.set({ name: "Alex" }));
  expect((await run(field.state.get))._tag).toBe("Validated");
  await run(field.clearValidation());
  await run(field.reset());
  expect(calls).toBe(2);
});

it("releases a child attachment without disposing its ancestor source", async () => {
  const test = await harness();
  const source = await run(test.ctx.signal({ initial: "original" }));
  const ready = Deferred.makeUnsafe<ValidationHandle<string, string>>();
  Effect.runSync(
    test.ctx.h(
      test.target,
      component(() =>
        Sync.succeed({
          setup: (context) =>
            Effect.gen(function* () {
              const field = yield* attach({ context, source, schema: Schema.String });
              const local = yield* context.signal({ initial: "child" });
              const rejected = yield* attach({
                context: test.ctx,
                source: local,
                schema: Schema.String,
              }).pipe(Effect.result);
              expect(Result.isFailure(rejected)).toBe(true);
              yield* Deferred.succeed(ready, field);
              return yield* context.he("output", { children: ["attached"] });
            }),
        }),
      ),
    ),
  );
  const field = await run(Deferred.await(ready));
  await rendered({ parent: test.parent, check: () => test.target.textContent === "attached" });
  await run(field.validate());
  Effect.runSync(test.ctx.h(test.target, []));
  await rendered({ parent: test.parent, check: () => test.target.textContent === "" });
  await run(source.set("still alive"));
  expect(await run(source.get)).toBe("still alive");
  expect(Result.isFailure(await run(field.clearValidation().pipe(Effect.result)))).toBe(true);
});
