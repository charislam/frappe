import {
  type Destination as InferredDestination,
  type ParseResult,
  type MatchedTarget,
  optionalQuery,
  parameter,
  route,
  router,
} from "@charismaticalli/frappe/router";
import { Match, Option, Result, Schema } from "effect";
import { BudgetId } from "~/budget/model";

export const urls = router([
  route({ tag: "Home", path: [] }),
  route({ tag: "Login", path: ["login"], query: { returnTo: optionalQuery(Schema.String) } }),
  route({
    tag: "VerifyCode",
    path: ["verify-code"],
    query: {
      email: optionalQuery(Schema.String),
      returnTo: optionalQuery(Schema.String),
    },
  }),
  route({ tag: "New", path: ["new"] }),
  route({ tag: "Budget", path: ["budget", parameter("id", BudgetId)] }),
]);
export type Destination = InferredDestination<typeof urls.definitions>;
export type Target = ParseResult<typeof urls.definitions>;
export const loginDestination = (
  returnTo: Option.Option<string>,
): Extract<Destination, { _tag: "Login" }> => ({
  _tag: "Login",
  params: {},
  query: { returnTo },
  fragment: Option.none(),
});
export const verificationDestination = (options: {
  email: Option.Option<string>;
  returnTo: Option.Option<string>;
}): Extract<Destination, { _tag: "VerifyCode" }> => ({
  _tag: "VerifyCode",
  params: {},
  query: options,
  fragment: Option.none(),
});
export const budgetDestination = (id: BudgetId): Extract<Destination, { _tag: "Budget" }> => ({
  _tag: "Budget",
  params: { id },
  query: {},
  fragment: Option.none(),
});
export const destination = (tag: Exclude<Destination["_tag"], "Budget">): Destination =>
  Match.value(tag).pipe(
    Match.when("Login", () => loginDestination(Option.none())),
    Match.when("VerifyCode", () =>
      verificationDestination({ email: Option.none(), returnTo: Option.none() }),
    ),
    Match.orElse((tag) => ({ _tag: tag, params: {}, query: {}, fragment: Option.none() })),
  );
export const targetFor = (destination: Destination): MatchedTarget<typeof urls.definitions> =>
  Result.getOrThrow(urls.resolve(destination));
export const targetOf = (tag: Exclude<Destination["_tag"], "Budget">): Target =>
  targetFor(destination(tag));

export const returnDestination = (returnTo: Option.Option<string>): Destination =>
  Option.match(returnTo, {
    onNone: () => destination("Home"),
    onSome: (path) =>
      Match.value(path.startsWith("/") && !path.startsWith("//")).pipe(
        Match.when(true, () =>
          Match.value(urls.parse(path)).pipe(
            Match.tag("Matched", ({ destination: target }) =>
              Match.value(target).pipe(
                Match.tag("Home", "New", "Budget", (target) => target),
                Match.orElse(() => destination("Home")),
              ),
            ),
            Match.orElse(() => destination("Home")),
          ),
        ),
        Match.orElse(() => destination("Home")),
      ),
  });
