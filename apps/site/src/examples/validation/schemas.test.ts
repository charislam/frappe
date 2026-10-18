import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { email, natural, password, text } from "./schemas";

describe("validation demo schemas", () => {
  it("trims text and email while preserving case and password whitespace", () => {
    expect(Schema.decodeUnknownSync(text)(" hello ")).toBe("hello");
    for (const input of ["", "   "])
      expect(Result.isFailure(Schema.decodeUnknownResult(text)(input))).toBe(true);
    expect(Schema.decodeUnknownSync(email)(" User@Example.com ")).toBe("User@Example.com");
    for (const input of ["", "a", "a@b", "a @b.com", "a@@b.com"])
      expect(Result.isFailure(Schema.decodeUnknownResult(email)(input))).toBe(true);
    for (const input of ["12345678", "        ", "😀😀😀😀"])
      expect(Schema.decodeUnknownSync(password)(input)).toBe(input);
    for (const input of ["", "1234567", "😀😀😀"])
      expect(Result.isFailure(Schema.decodeUnknownResult(password)(input))).toBe(true);
  });
  it.each([
    ["0", 0],
    ["000", 0],
    ["0012", 12],
    [" 12 ", 12],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
  ])("decodes %s without changing the raw input", (input, expected) => {
    expect(Schema.decodeUnknownSync(natural)(input)).toBe(expected);
  });
  it.each([
    "9007199254740992",
    "999999999999999999999999999999999",
    "",
    " ",
    "-1",
    "+1",
    "1.0",
    "1.",
    "1e3",
    "1E3",
    "1 2",
    "1,000",
    "12abc",
    "１２",
    "١٢",
  ])("rejects %s", (input) => {
    expect(Result.isFailure(Schema.decodeUnknownResult(natural)(input))).toBe(true);
  });
});
