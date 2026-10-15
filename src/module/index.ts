import type { Session } from "#core/session";
import { ModuleLoadMode } from "#core/types";
import type { Module, ModuleBase } from "./module";
import { PlanBuildModule } from "./plan-build";

const modules: ModuleBase[] = [PlanBuildModule];

/** Builds every module, runs `init()` on the `ON_LOAD` ones, and records their info in `session.modules`. */
export function loadModules(session: Session): Module[] {
  const moduleList = modules.map((module: ModuleBase) => new module(session));
  for (const module of moduleList) {
    if (module.info.loadType === ModuleLoadMode.ON_DEMAND) continue;
    module.init();
  }

  session.modules = moduleList.map((m) => ({
    ...m.info,
    isLoaded: m.info.loadType !== ModuleLoadMode.ON_DEMAND,
  }));
  return moduleList;
}
