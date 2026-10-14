import type { Session } from "#core/session";
import { ModuleLoadMode } from "#core/types";
import type { Module, ModuleBase } from "./module";
import { PlanBuildModule } from "./plan-build";

const modules: ModuleBase[] = [PlanBuildModule];

export function loadModules(session: Session): Module[] {
  const moduleList = modules.map((module: ModuleBase) => new module(session));
  for (const module of moduleList) {
    if (module.info.loadType === ModuleLoadMode.ON_DEMAND) continue;
    module.init();
    module.info.isLoaded = true;
  }

  session.modules = moduleList.map((m) => m.info);
  return moduleList;
}
