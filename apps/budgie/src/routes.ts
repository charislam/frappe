import {
  type Destination as InferredDestination,
  type ParseResult,
  type MatchedTarget,
  optionalQuery,
  route,
  router,
} from "@charismaticalli/frappe/router";
import { Match, Option, Result, Schema } from "effect";

export const urls = router([
  route({ tag: "Home", path: [] }),
  route({ tag: "Login", path: ["login"] }),
  route({
    tag: "VerifyCode",
    path: ["verify-code"],
    query: {
      email: optionalQuery(Schema.String),
    },
  }),
  route({ tag: "Accounts", path: ["accounts"] }),
  route({ tag: "Callback", path: ["auth", "callback"] }),
]);
export type Destination = InferredDestination<typeof urls.definitions>;
export type Target = ParseResult<typeof urls.definitions>;
export const verificationDestination = (
  email: Option.Option<string>,
): Extract<Destination, { _tag: "VerifyCode" }> => ({
  _tag: "VerifyCode",
  params: {},
  query: { email },
  fragment: Option.none(),
});
export const destination = (tag: Destination["_tag"]): Destination =>
  Match.value(tag).pipe(
    Match.when("VerifyCode", () => verificationDestination(Option.none())),
    Match.orElse((tag) => ({ _tag: tag, params: {}, query: {}, fragment: Option.none() })),
  );
export const targetFor = (destination: Destination): MatchedTarget<typeof urls.definitions> =>
  Result.getOrThrow(urls.resolve(destination));
export const targetOf = (tag: Destination["_tag"]): Target => targetFor(destination(tag));
