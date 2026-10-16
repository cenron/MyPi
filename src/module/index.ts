import type { SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { pickLoaded } from "#core/module-manager";
import type { Session } from "#core/session";
import type { ModuleBase } from "#core/types";
import { PlanBuildModule } from "./plan-build";

const modules: ModuleBase[] = [PlanBuildModule];

/** Builds every module and starts the ones `pickLoaded` chooses for this `reason`. */
export function loadModules(
  session: Session,
  reason: SessionStartEvent["reason"],
) {
  const moduleList = modules.map((module: ModuleBase) => new module(session));
  const names = pickLoaded(
    reason,
    undefined, // the saved set comes with persistence
    moduleList.map((module) => module.info),
  );
  session.moduleManager.start(moduleList, names);
}
