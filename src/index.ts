import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("mypi", {
    description: "Show MyPi status",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) ctx.ui.notify("MyPi is loaded.", "info");
    },
  });
}
