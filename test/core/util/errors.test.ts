import { describe, expect, it } from "vitest";
import { errorMessage, isNodeError } from "#core/util/errors";

describe("errorMessage", () => {
  it("returns the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies anything else", () => {
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("isNodeError", () => {
  it("is true for an Error with a code", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });
    expect(isNodeError(error)).toBe(true);
  });

  it("is false for an Error without a code or a non-Error", () => {
    expect(isNodeError(new Error("plain"))).toBe(false);
    expect(isNodeError({ code: "ENOENT" })).toBe(false);
  });
});
