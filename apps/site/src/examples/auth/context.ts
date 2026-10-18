import { Context, type Signal } from "@charismaticalli/frappe";
import type { User } from "~/auth-model";

/** Only the authenticated branch provides this context. */
export class CurrentUser extends Context.Service<CurrentUser, Signal<User>>()(
  "frappe/CurrentUser",
) {}
