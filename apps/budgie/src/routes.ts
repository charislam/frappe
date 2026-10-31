import {
  type Destination as InferredDestination,
  type ParseResult,
  type MatchedTarget,
  defaultQuery,
  optionalQuery,
  route,
  router,
} from "@charismaticalli/frappe/router";
import { Match, Option, Result, Schema } from "effect";

export const urls = router([
  route({ tag: "Home", path: [] }),
  route({ tag: "Login", path: ["login"] }),
  route({ tag: "Signup", path: ["signup"] }),
  route({
    tag: "VerifyCode",
    path: ["verify-code"],
    query: {
      email: optionalQuery(Schema.String),
      intent: defaultQuery(Schema.Literals(["signin", "signup"]), "signin"),
    },
  }),
  route({ tag: "Accounts", path: ["accounts"] }),
  route({ tag: "Callback", path: ["auth", "callback"] }),
]);
export type Destination = InferredDestination<typeof urls.definitions>;
export type Target = ParseResult<typeof urls.definitions>;
export const verificationDestination = (options: {
  email: Option.Option<string>;
  intent: "signin" | "signup";
}): Extract<Destination, { _tag: "VerifyCode" }> => ({
  _tag: "VerifyCode",
  params: {},
  query: options,
  fragment: Option.none(),
});
export const destination = (tag: Destination["_tag"]): Destination =>
  Match.value(tag).pipe(
    Match.when("VerifyCode", () =>
      verificationDestination({ email: Option.none(), intent: "signin" }),
    ),
    Match.orElse((tag) => ({ _tag: tag, params: {}, query: {}, fragment: Option.none() })),
  );
export const targetFor = (destination: Destination): MatchedTarget<typeof urls.definitions> =>
  Result.getOrThrow(urls.resolve(destination));
export const targetOf = (tag: Destination["_tag"]): Target => targetFor(destination(tag));
