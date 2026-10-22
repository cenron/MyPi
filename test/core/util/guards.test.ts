import { describe, expect, it } from "vitest";
import { isNonEmptyString, isRecord } from "#core/util/guards";

describe("isRecord", () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [null, false],
    [[], false],
    ["text", false],
    [undefined, false],
  ])("%j → %s", (value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });
});

describe("isNonEmptyString", () => {
  it.each([
    ["a", true],
    ["", false],
    [null, false],
    [1, false],
  ])("%j → %s", (value, expected) => {
    expect(isNonEmptyString(value)).toBe(expected);
  });
});
