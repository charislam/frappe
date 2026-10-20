import { Sync, component } from "@charismaticalli/frappe";
import { type Navigator, link } from "@charismaticalli/frappe/router";
import { Effect } from "effect";
import { AuthError } from "~/auth/model";
import { type Destination, urls } from "~/routes";
import type { AppEvent } from "~/transitions";

export type AuthNavigation = Navigator<typeof urls.definitions, AppEvent>;
export const AuthLink = (options: {
  navigation: AuthNavigation;
  destination: Destination;
  label: string;
}) =>
  component((context) =>
    Sync.gen(function* () {
      const anchor = yield* link({
        context,
        router: urls,
        navigator: options.navigation,
        destination: options.destination,
        children: [options.label],
      });
      return { setup: () => Effect.succeed(anchor) };
    }),
  );
export const navigateAuth = (options: {
  navigation: AuthNavigation;
  destination: Destination;
  mode: "push" | "replace";
}) =>
  options.navigation.navigate(options.destination, { mode: options.mode }).pipe(
    Effect.mapError(
      () =>
        new AuthError({
          kind: "other",
          message: "Unable to open the next page. Please try again.",
        }),
    ),
  );
