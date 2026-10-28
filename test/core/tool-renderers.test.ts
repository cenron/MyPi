import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { RendererChain } from "#core/tool-renderers";

/** A resolver that wraps what comes after it by adding its name to `renderShell`, so the order shows in the result. */
function tagging(name: string) {
  return (_toolName: string, next: () => ToolRenderers | undefined): ToolRenderers =>
    ({ renderShell: `${name}>${next()?.renderShell ?? "pi"}` }) as unknown as ToolRenderers;
}

describe("RendererChain", () => {
  it("passes pi's renderers through when no module set one", () => {
    const pi = { renderShell: "default" } as ToolRenderers;
    expect(new RendererChain().resolve("read", () => pi)).toBe(pi);
  });

  it("chains resolvers in the order set, each wrapping the ones after it, then pi's", () => {
    const chain = new RendererChain();
    chain.set("quiet", tagging("quiet"));
    chain.set("theme", tagging("theme"));
    expect(chain.resolve("read", () => undefined)?.renderShell).toBe("quiet>theme>pi");
  });

  it("removes a module's resolver with undefined", () => {
    const chain = new RendererChain();
    chain.set("quiet", tagging("quiet"));
    chain.set("quiet", undefined);
    expect(chain.resolve("read", () => undefined)).toBeUndefined();
  });
});
