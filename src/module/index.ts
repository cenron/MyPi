import type { SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import type { ModuleClass } from "#core/types";
import { AnalyticsModule } from "./analytics";
import { ContextModule } from "./context";
import { DoneCheckModule } from "./done-check";
import { LspModule } from "./lsp";
import { MemoryModule } from "./memory";
import { PlanBuildModule } from "./plan-build";
import { SubagentsModule } from "./subagents";
import { TodoModule } from "./todo";

const modules: ModuleClass[] = [
  PlanBuildModule,
  AnalyticsModule,
  MemoryModule,
  LspModule,
  DoneCheckModule,
  ContextModule,
  SubagentsModule,
  TodoModule,
];

/**
 * Builds every module and hands them to the session's `ModuleManager`, which picks the ones to load for `reason`.
 * `moduleManager.init()` runs them later, once their tools are registered.
 */
export function loadModules(session: Session, reason: SessionStartEvent["reason"]) {
  const moduleList = modules.map((module) => new module(session));
  session.moduleManager.start(moduleList, reason);
}
