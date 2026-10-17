import { expect, it } from "vitest";
import { decodePreference, resolveTheme } from "./model";

it.each([null, undefined, "", "LIGHT", '"dark"', "unknown"])(
  "defaults invalid preference %s",
  (value) => {
    expect(decodePreference(value)).toBe("system");
  },
);
it.each([
  ["light", false, "light"],
  ["light", true, "light"],
  ["dark", false, "dark"],
  ["dark", true, "dark"],
  ["system", false, "light"],
  ["system", true, "dark"],
] as const)("resolves %s with dark OS %s", (preference, systemDark, expected) => {
  expect(resolveTheme({ preference, systemDark })).toBe(expected);
});
