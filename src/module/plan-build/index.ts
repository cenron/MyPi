import type { Session } from "#core/session";
import {
  type Command,
  type Module,
  type ModuleInfo,
  ModuleLoadMode,
} from "#core/types";

export class PlanBuildModule implements Module {
  constructor(readonly session: Session) {}

  get info(): ModuleInfo {
    return {
      name: "plan-build",
      description:
        "Plan changes in a restricted mode, then switch to Build to implement them.",
      commands: this.commands().flatMap((command) => command.info),
      loadType: ModuleLoadMode.ON_DEMAND,
    };
  }

  init(): void {
    this.session.logError("Plan module initialized");
    return;
  }

  commands(): Command[] {
    return [
      {
        info: {
          name: "plan-build",
          description: "Build a plan",
        },
        execute: async () => {
          this.session.logError("Plan build command not implemented");
        },
      },
    ];
  }
}
