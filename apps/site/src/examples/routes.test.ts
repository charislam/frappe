import { expect, it } from "vitest";
import { urls } from "~/routes";
import { examplesPageOf } from "./routes";

it("preserves the examples default", () => {
  expect(examplesPageOf("Examples")).toEqual({ _tag: "Examples", page: { _tag: "Counter" } });
  expect(urls.parse("/examples/routing")).toMatchObject({
    _tag: "Matched",
    destination: { _tag: "Routing" },
  });
  expect(urls.parse("/examples/queries")).toMatchObject({
    _tag: "Matched",
    destination: { _tag: "Queries" },
  });
  expect(urls.parse("/examples/routing/projects/wrong-id")).toMatchObject({
    ancestry: expect.arrayContaining([expect.objectContaining({ _tag: "Routing" })]),
  });
});
