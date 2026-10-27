import { type ExtensionContext, initTheme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it } from "vitest";
import { openToggleDialog } from "#ui/components/toggle-dialog";
import { customPressing, KEY } from "../../fakes";

const { SPACE, ENTER, DOWN } = KEY;

function context(keys: string[]) {
  const custom = customPressing(keys);
  return { ctx: { ui: { custom } } as unknown as ExtensionContext, custom };
}

beforeAll(() => initTheme("dark"));

describe("openToggleDialog", () => {
  it("returns only enabled ids on Save and cancels on Escape", async () => {
    const items = [
      { id: "a", label: "A", on: true },
      { id: "b", label: "B", on: false },
    ];
    const save = context([SPACE, DOWN, SPACE, DOWN, ENTER]);
    expect(await openToggleDialog(save.ctx, "Options", items)).toEqual(new Set(["b"]));
    expect(save.custom.mock.calls[0]?.[1]).toEqual({
      overlay: true,
      overlayOptions: { anchor: "center", width: 100, maxHeight: "70%" },
    });

    expect(await openToggleDialog(context(["\x1b"]).ctx, "Options", items)).toBeUndefined();
  });
});
