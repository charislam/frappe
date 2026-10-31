import { Sync, component } from "@charismaticalli/frappe";
import { link } from "@charismaticalli/frappe/router";
import { Effect, Option } from "effect";
import { Navigation } from "~/context";
import { type Destination, urls } from "~/routes";

export const AuthLink = (options: { destination: Destination; label: string }) =>
  component((context) =>
    Sync.gen(function* () {
      const navigation = yield* Sync.service(Navigation);
      const anchor = yield* link({
        context,
        router: urls,
        navigator: navigation,
        destination: options.destination,
        children: [options.label],
      });
      return {
        setup: (context) =>
          context
            .bind({ element: anchor, attrs: { class: Option.some("auth-link") } })
            .pipe(Effect.as(anchor)),
      };
    }),
  );
export const navigateAuth = (options: { destination: Destination; mode: "push" | "replace" }) =>
  Navigation.pipe(
    Effect.flatMap((navigation) =>
      navigation.navigate(options.destination, { mode: options.mode }),
    ),
  );
