import { type Command, type ModuleInfo, ModuleLoadMode } from "#core/types";
import { FooterColor, type FooterItem } from "#ui/footer";
import { BaseModule } from "../base";
import { BUILD_PROMPT, PLAN_PROMPT } from "./prompts";

const Mode = {
  PLAN: "plan",
  BUILD: "build",
} as const;

type Mode = (typeof Mode)[keyof typeof Mode];
const isMode = (value: unknown): value is Mode => (Object.values(Mode) as unknown[]).includes(value);

export class PlanBuildModule extends BaseModule<{ mode: Mode }> {
  private mode: Mode = Mode.PLAN;
  private footerItems: Record<Mode, FooterItem> = {
    [Mode.PLAN]: { text: "PLAN", color: FooterColor.Warning },
    [Mode.BUILD]: { text: "BUILD", color: FooterColor.Dim },
  };

  private prompts: Record<Mode, string> = {
    [Mode.PLAN]: PLAN_PROMPT,
    [Mode.BUILD]: BUILD_PROMPT,
  };

  get info(): ModuleInfo {
    return {
      name: "plan-build",
      description: "Plan changes in a restricted mode, then switch to Build to implement them.",
      commands: this.commands().flatMap((command) => command.info),
      loadType: ModuleLoadMode.ALWAYS,
    };
  }

  init(): void {
    const savedMode = this.loadState()?.mode;
    this.mode = isMode(savedMode) ? savedMode : Mode.PLAN;
    this.setFooter(this.footerItems[this.mode]);
    this.setPrompt(this.prompts[this.mode]);
    this.onKey("shift+tab", () => this.toggleMode());
    return;
  }

  commands(): Command[] {
    return [
      {
        info: {
          name: "plan",
          description: "Toggle Plan/Build mode (plan|build: pick one)",
        },
        execute: async (_ctx, args) => {
          const [arg] = args;
          if (arg === undefined) {
            this.toggleMode();
            return;
          }

          if (!isMode(arg)) throw new Error(`Unknown mode: ${arg} (use plan or build)`);
          this.setMode(arg);
        },
      },
    ];
  }

  private toggleMode() {
    this.setMode(this.mode === Mode.PLAN ? Mode.BUILD : Mode.PLAN);
  }
  private setMode(mode: Mode): void {
    this.mode = isMode(mode) ? mode : Mode.PLAN;

    this.saveState({ mode: this.mode });
    this.setFooter(this.footerItems[this.mode]);
    this.setPrompt(this.prompts[this.mode]);
  }
}
