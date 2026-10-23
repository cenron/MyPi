import { homedir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionContext,
  isEditToolResult,
  isWriteToolResult,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { keepOutOfGit } from "#core/util/git";
import { isInside, resolveToolPath } from "#core/util/paths";
import { BaseModule } from "../base";
import { globalMemoryDir, PROJECT_MEMORY_DIR, readMemories } from "./folders";
import { memoryPrompt } from "./prompt";
import type { MemoryScope } from "./types";

export class MemoryModule extends BaseModule {
  // Pi builds a new session and new modules on every session_start, so the cwd can't change under these.
  private readonly projectDir = join(this.session.ctx.cwd, PROJECT_MEMORY_DIR);
  private readonly globalDir = globalMemoryDir();

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
    this.refresh();
    this.session.pi.on("tool_result", (ev, ctx) => this.onToolResult(ev, ctx));
  }

  /** Rebuilds the prompt section from both folders; the next run sends it. */
  private refresh() {
    this.setPrompt(memoryPrompt(this.readScope(this.projectDir), this.readScope(this.globalDir)));
  }

  /**
   * After a successful write or edit under a memory folder: keep the project folder out of git, then refresh. `rm` in
   * bash and edits by hand show after /reload.
   */
  private async onToolResult(ev: ToolResultEvent, ctx: ExtensionContext) {
    if (ev.isError || !(isWriteToolResult(ev) || isEditToolResult(ev))) return;

    const path = ev.input.path;
    if (typeof path !== "string") return;

    const file = resolveToolPath(path, ctx.cwd, homedir());
    const isProjectMemory = isInside(this.projectDir, file);

    if (isProjectMemory) await this.keepProjectOutOfGit();
    if (isProjectMemory || isInside(this.globalDir, file)) this.refresh();
  }

  /** The write already worked, so a failure here warns with the fix instead of failing the tool call. */
  private async keepProjectOutOfGit() {
    try {
      await keepOutOfGit(this.projectDir);
    } catch (error) {
      this.session.logWarning(
        `Memory: couldn't create ${join(this.projectDir, ".gitignore")}: ${errorMessage(error)}. ` +
          "Project memories may be committed; create it with *.",
      );
    }
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
