import type { Session } from "#core/session";
import type { Command, ModuleInfo } from "#core/types";

export type ModuleBase = new (session: Session) => Module;

export interface Module {
  readonly session: Session;

  get info(): ModuleInfo;

  init(): void;

  commands(): Command[];
}
