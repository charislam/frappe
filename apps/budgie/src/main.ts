import { Cause, ConfigProvider, Effect, Fiber, Match } from "effect";
import { bootstrap } from "./bootstrap";
import "./style.css";

const application = Effect.runFork(
  bootstrap((failure) => console.error("Budgie mount failed", failure)).pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(import.meta.env))),
    Effect.tapCause((cause) =>
      Match.value(Cause.hasInterruptsOnly(cause)).pipe(
        Match.when(true, () => Effect.void),
        Match.orElse(() =>
          Effect.sync(() => {
            const root = document.getElementById("app");
            const message = document.createElement("p");
            message.setAttribute("role", "alert");
            message.textContent =
              "Budgie could not start. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in apps/budgie/.env.local, then restart Vite.";
            root?.replaceChildren(message);
            console.error(Cause.pretty(cause));
          }),
        ),
      ),
    ),
  ),
);
import.meta.hot?.dispose(() => {
  Effect.runFork(Fiber.interrupt(application));
});
