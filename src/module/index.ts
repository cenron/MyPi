import type { Session } from "#core/session";
import type { Module, ModuleBase } from "./module";
import { PlanBuildModule } from "./plan-build";

const modules: ModuleBase[] = [PlanBuildModule];

export function loadModules(session: Session): Module[] {
  const moduleList = modules.map((module: ModuleBase) => new module(session));
  for (const module of moduleList) {
    module.init();
  }
  return moduleList;
}
