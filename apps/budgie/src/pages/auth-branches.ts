import { type Signal, Sync, branch } from "@charismaticalli/frappe";
import { Effect } from "effect";
import type { View } from "~/transitions";
import { Login } from "./login";
import { VerifyCode } from "./verify-code";

type Page<Tag extends View["_tag"]> = Extract<View, { _tag: Tag }>;
export const authBranches = () => ({
  Login: {
    key: (page: Page<"Login">) => Object.freeze({ returnTo: page.returnTo }),
    branch: branch<Page<"Login">, Signal<Page<"Login">>>()(({ inputs }) =>
      Sync.succeed({
        setup: () => inputs.state.get.pipe(Effect.map(({ returnTo }) => Login({ returnTo }))),
      }),
    ),
  },
  VerifyCode: {
    key: (page: Page<"VerifyCode">) =>
      Object.freeze({ email: page.email, returnTo: page.returnTo }),
    branch: branch<Page<"VerifyCode">, Signal<Page<"VerifyCode">>>()(({ inputs }) =>
      Sync.succeed({
        setup: () =>
          inputs.state.get.pipe(
            Effect.map((page) => VerifyCode({ email: page.email, returnTo: page.returnTo })),
          ),
      }),
    ),
  },
});
