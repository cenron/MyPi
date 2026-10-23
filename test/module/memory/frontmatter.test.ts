import { describe, expect, it } from "vitest";
import { parseDescription } from "#module/memory/frontmatter";

describe("parseDescription", () => {
  it.each([
    ["a plain value", "---\ndescription: How to run the tests\n---\nBody", "How to run the tests"],
    ["double quotes", '---\ndescription: "Quoted: with a colon"\n---\n', "Quoted: with a colon"],
    ["single quotes", "---\ndescription: 'Single'\n---\n", "Single"],
    ["an unmatched quote", "---\ndescription: 'Tis kept\n---\n", "'Tis kept"],
    ["CRLF line ends", "---\r\ndescription: Windows\r\n---\r\n", "Windows"],
    ["other keys around it", "---\nname: old\ndescription: Kept\ntags: x\n---\n", "Kept"],
    ["no frontmatter", "description: Not frontmatter\n", undefined],
    ["no closing fence", "---\ndescription: Never closed\n", undefined],
    ["the key only in the body", "---\nname: x\n---\ndescription: In the body\n", undefined],
    ["an empty value", "---\ndescription:   \n---\n", undefined],
  ])("%s", (_rule, text, description) => {
    expect(parseDescription(text)).toBe(description);
  });
});
