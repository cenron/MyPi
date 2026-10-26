import { describe, expect, it } from "vitest";
import { isThinkingLevel } from "#core/util/thinking";

describe("isThinkingLevel", () => {
  it.each([
    ["off", true],
    ["high", true],
    ["xhigh", true],
    ["max", true],
    ["inherit", false],
    ["huge", false],
    [3, false],
    [undefined, false],
  ])("%s → %s", (value, expected) => {
    expect(isThinkingLevel(value)).toBe(expected);
  });
});
