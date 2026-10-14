import type { Command } from "#command/types";
import type { Session } from "#core/session";
import type { Module } from "../module.ts";

export class PlanBuildModule implements Module {
  constructor(readonly session: Session) {}

  init(): void {
    this.session.log_error("Plan module initialized");
    return;
  }

  commands(): Command[] {
    return [
      {
        name: "plan-build",
        description: "Build a plan",
        execute: async () => {
          this.session.log_error("Plan build command not implemented");
        },
      },
    ];
  }
}
