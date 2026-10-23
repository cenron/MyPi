import { join } from "node:path";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { BaseModule } from "../base";
import { globalMemoryDir, PROJECT_MEMORY_DIR, readMemories } from "./folders";
import { memoryPrompt } from "./prompt";
import type { MemoryScope } from "./types";

export class MemoryModule extends BaseModule {
  get info(): ModuleInfo {
    return {
      name: "memory",
      description:
        "Markdown memories per project and global; the prompt lists them, and the agent reads what it needs.",
      commands: [],
      loadType: ModuleLoadMode.ALWAYS,
    };
  }

  init(): void {
    const projectScope = this.readScope(join(this.session.ctx.cwd, PROJECT_MEMORY_DIR));
    const globalScope = this.readScope(globalMemoryDir());
    this.setPrompt(memoryPrompt(projectScope, globalScope));
  }

  /** A folder that can't be read warns and is listed as unreadable, so the modules after memory still start. */
  private readScope(dir: string): MemoryScope {
    try {
      return { dir, memories: readMemories(dir) };
    } catch (error) {
      this.session.logWarning(
        `Memory: can't read ${dir}: ${errorMessage(error)}. Check its permissions, then /reload.`,
      );
      return { dir, memories: undefined };
    }
  }
}
