import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { Footer, FooterColor } from "#ui/footer";
import { fakeUI } from "../fakes";

function fakeFooter() {
  const ui = fakeUI();
  const footer = new Footer({ ui } as unknown as ExtensionContext);
  return { footer, setStatus: ui.setStatus };
}

describe("Footer", () => {
  it("draws an item as the mypi-<key> status, in its color", () => {
    const { footer, setStatus } = fakeFooter();
    footer.set("plan-build", { text: "⏸ plan", color: FooterColor.WARNING });
    expect(setStatus).toHaveBeenCalledWith("mypi-plan-build", "<warning>⏸ plan");
  });

  it("clears the status when the item is set to undefined", () => {
    const { footer, setStatus } = fakeFooter();
    footer.set("plan-build", { text: "⏸ plan", color: FooterColor.WARNING });
    footer.set("plan-build", undefined);
    expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", undefined);
  });

  it("redraws only the key that changed", () => {
    const { footer, setStatus } = fakeFooter();
    footer.set("a", { text: "one", color: FooterColor.DIM });
    footer.set("b", { text: "two", color: FooterColor.ACCENT });
    footer.set("a", { text: "three", color: FooterColor.SUCCESS });
    expect(setStatus.mock.calls).toEqual([
      ["mypi-a", "<dim>one"],
      ["mypi-b", "<accent>two"],
      ["mypi-a", "<success>three"],
    ]);
  });
});
