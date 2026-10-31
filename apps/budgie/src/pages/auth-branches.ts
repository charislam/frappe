import { type Signal, Sync, branch } from "@charismaticalli/frappe";
import { Effect } from "effect";
import type { View } from "~/transitions";
import type { AuthNavigation } from "./auth-navigation";
import { Login } from "./login";
import { VerifyCode } from "./verify-code";

type Page<Tag extends View["_tag"]> = Extract<View, { _tag: Tag }>;
export const authBranches = (navigation: AuthNavigation) => ({
  Login: {
    branch: branch<Page<"Login">, Signal<Page<"Login">>>()(() =>
      Sync.succeed({ setup: () => Effect.succeed(Login(navigation)) }),
    ),
  },
  VerifyCode: {
    key: (page: Page<"VerifyCode">) => Object.freeze({ email: page.email }),
    branch: branch<Page<"VerifyCode">, Signal<Page<"VerifyCode">>>()(({ inputs }) =>
      Sync.succeed({
        setup: () =>
          inputs.state.get.pipe(
            Effect.map((page) =>
              VerifyCode({ navigation, email: page.email }),
            ),
          ),
      }),
    ),
  },
});
