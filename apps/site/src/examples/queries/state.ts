import { QueryState } from "@charismaticalli/frappe/query";
import { Option } from "effect";

export const queryValue = <I, A, E>(state: QueryState.QueryState<I, A, E>): Option.Option<A> =>
  QueryState.match(state, {
    onInitial: (state) => Option.map(state.previousSuccess, (previous) => previous.previousData),
    onSuccess: (state) => Option.some(state.value),
    onFailure: (state) => Option.map(state.previousSuccess, (previous) => previous.previousData),
  });
