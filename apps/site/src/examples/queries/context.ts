import { Context, type WritableSignal } from "@charismaticalli/frappe";
import { Option } from "effect";

export class QueryDemoSession extends Context.Service<
  QueryDemoSession,
  WritableSignal<Option.Option<string>>
>()("QueryDemoSession") {}
