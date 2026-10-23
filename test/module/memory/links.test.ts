import { describe, expect, it } from "vitest";
import { linksIn, memoryNames } from "#module/memory/links";

describe("linksIn", () => {
  it.each([
    ["one link", "See [[build]].", ["build"]],
    ["several, in order", "[[b]] then [[a]]", ["b", "a"]],
    ["a repeat once", "[[a]] and [[a]] again", ["a"]],
    ["a topic path", "See [[build/tests]].", ["build/tests"]],
    ["not bash's test brackets", "if [[ -f x ]]; then", []],
    ["not empty brackets", "[[]] and [[ ]]", []],
    ["none in plain text", "No links here.", []],
  ])("finds %s", (_rule, text, links) => {
    expect(linksIn(text)).toEqual(links);
  });
});

describe("memoryNames", () => {
  // A link resolves in either scope; an unreadable one can't vouch for any name.
  it("collects names from every readable scope", () => {
    const memory = (name: string) => ({ name, description: undefined, links: [] });
    const names = memoryNames(
      { dir: "/p", memories: [memory("build")] },
      { dir: "/g", memories: [memory("style")] },
      { dir: "/x", memories: undefined },
    );
    expect([...names]).toEqual(["build", "style"]);
  });
});
