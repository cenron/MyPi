import type { Command } from "#command/types";
import type { Session } from "#core/session";

export type ModuleBase = new (session: Session) => Module;

export interface Module {
  readonly session: Session;

  init(): void;

  commands(): Command[];
}
