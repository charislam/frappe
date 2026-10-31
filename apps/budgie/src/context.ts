import { Context } from "@charismaticalli/frappe";
import type { Client } from "@charismaticalli/frappe/query";
import type { Navigator } from "@charismaticalli/frappe/router";
import type { urls } from "./routes";
import type { AppEvent } from "./transitions";

export class Navigation extends Context.Service<
  Navigation,
  Navigator<typeof urls.definitions, AppEvent>
>()("budgie/Navigation") {}
export class Queries extends Context.Service<Queries, Client>()("budgie/Queries") {}
