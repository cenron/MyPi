import type { SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import type { ModuleBase } from "#core/types";
import { PlanBuildModule } from "./plan-build";

const modules: ModuleBase[] = [PlanBuildModule];

/** Builds every module and hands them to the session's `ModuleManager`, which starts the ones to load for `reason`. */
export function loadModules(session: Session, reason: SessionStartEvent["reason"]) {
  const moduleList = modules.map((module: ModuleBase) => new module(session));
  session.moduleManager.start(moduleList, reason);
}
