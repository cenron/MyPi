import { describe, expect, it } from "vitest";
import { textOf } from "#ui/render";

describe("textOf", () => {
  it.each([
    [
      "joins text parts with a newline",
      [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
      "one\ntwo",
    ],
    [
      "skips parts that aren't text",
      [
        { type: "image", data: "…" },
        { type: "text", text: "one" },
      ],
      "one",
    ],
    ["is empty for anything but a list", undefined, ""],
  ])("%s", (_rule, content, expected) => {
    expect(textOf(content)).toBe(expected);
  });
});
