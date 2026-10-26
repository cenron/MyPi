import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AgentToolResult, defineTool, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { Session } from "#core/session";
import { isPlanMode } from "#core/util/mode";
import { git, gitOutput, validateName } from "#core/worktree/git";
import { PATCHES_DIR } from "../writer";

const CANCEL = "Cancel";
const APPLY = "Apply";
const DROP = "Drop";
const SUMMARY_LINES = 5;

const parameters = Type.Object({
  name: Type.String({ description: "The patch name returned by a write subagent." }),
});

type ApplyArgs = Static<typeof parameters>;

type SavedPatch = {
  readonly name: string;
  readonly patchPath: string;
  readonly handoffPath: string;
  readonly agent: string;
  readonly task: string;
  readonly diffStat: string;
  readonly summary: string;
  readonly files: string[];
};

/** Applies or drops a saved writer patch only after the user chooses in a dialog. */
export function subagentApplyTool(session: Session) {
  return defineTool({
    name: "subagent_apply",
    label: "Apply subagent patch",
    description:
      "After a write subagent's result names a patch, call this to show it to the user, who applies or drops it. " +
      "Never apply a patch with `git apply` in `bash`. It applies only after the user's approval, or drops the patch.",
    promptSnippet: "Apply a writer's patch after user confirmation",
    parameters,
    async execute(_id, { name }: ApplyArgs, _signal, _onUpdate, ctx) {
      try {
        validateName(name);
      } catch {
        throw new Error(await unknownPatch(session, name));
      }
      if (await isPlanMode(session.pi.events)) {
        throw new Error("Plan mode is on. Switch to Build to apply a subagent patch.");
      }
      if (!ctx.hasUI) {
        throw new Error("This patch needs the user's approval, and no one can give it here (no UI).");
      }

      const patch = await readPatch(session, name);
      const choice = await askUser(ctx, patch);
      if (choice === DROP) {
        await rm(patch.patchPath);
        await rm(patch.handoffPath);
        return text(`Dropped ${name}.`);
      }
      if (choice !== APPLY) return text("Cancelled; the patch was left unchanged.");
      return applyPatch(session, patch);
    },
  });
}

async function readPatch(session: Session, name: string): Promise<SavedPatch> {
  const patches = join(session.project?.main ?? session.ctx.cwd, PATCHES_DIR);
  const patchPath = join(patches, `${name}.patch`);
  const handoffPath = join(patches, `${name}.md`);
  let handoff: string;
  try {
    handoff = await readFile(handoffPath, "utf8");
    await readFile(patchPath);
  } catch {
    throw new Error(await unknownPatch(session, name));
  }

  const files = section(handoff, "Files")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
  return {
    name,
    patchPath,
    handoffPath,
    agent: handoff.match(/^# (.+)$/m)?.[1] ?? "subagent",
    task: section(handoff, "Task").split("\n", 1)[0] ?? "",
    diffStat: section(handoff, "Diff stat"),
    summary: section(handoff, "Summary").split("\n").slice(0, SUMMARY_LINES).join("\n"),
    files,
  };
}

async function askUser(ctx: ExtensionToolContext, patch: SavedPatch): Promise<string | undefined> {
  return ctx.ui.select(
    [`Apply the ${patch.agent} patch?`, patch.task, patch.diffStat, patch.summary].filter(Boolean).join("\n\n"),
    [CANCEL, APPLY, DROP],
    { signal: ctx.signal },
  );
}

async function applyPatch(session: Session, patch: SavedPatch): Promise<AgentToolResult> {
  try {
    const checkout = (await git(session.ctx.cwd, ["rev-parse", "--show-toplevel"])).trim();
    const check = await checkPatch(checkout, patch.patchPath);
    if (check.failed || check.output.includes("with conflicts")) {
      return text(`Could not apply ${patch.name}; the patch was kept.\n${check.output.trimEnd()}`);
    }
    await git(checkout, ["apply", "--3way", patch.patchPath]);
  } catch (error) {
    return text(
      `Could not apply ${patch.name}; the patch was kept.\n${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await rm(patch.patchPath);
  await rm(patch.handoffPath);
  return text(`Applied ${patch.name}. Files: ${patch.files.join(", ") || "none"}.`);
}

async function checkPatch(cwd: string, patchPath: string): Promise<{ failed: boolean; output: string }> {
  try {
    const { stderr, stdout } = await gitOutput(cwd, ["apply", "--3way", "--index", "--check", patchPath]);
    return { failed: false, output: `${stdout}${stderr}` };
  } catch (error) {
    if (!(error instanceof Error) || !("stderr" in error)) throw error;
    const output = ["stdout" in error ? error.stdout : undefined, error.stderr]
      .filter((part): part is string => typeof part === "string")
      .join("");
    return { failed: true, output: output || error.message };
  }
}

async function unknownPatch(session: Session, name: string): Promise<string> {
  const patches = join(session.project?.main ?? session.ctx.cwd, PATCHES_DIR);
  const names = (await readdir(patches).catch(() => []))
    .filter((file) => file.endsWith(".patch"))
    .map((file) => file.slice(0, -6));
  return `No patch '${name}'. Available patches: ${names.join(", ") || "none"}.`;
}

function section(handoff: string, heading: string): string {
  const start = handoff.indexOf(`## ${heading}\n`);
  if (start < 0) return "";
  const contentStart = start + heading.length + 4;
  const end = handoff.indexOf("\n## ", contentStart);
  return handoff.slice(contentStart, end < 0 ? undefined : end).trim();
}

function text(message: string): AgentToolResult {
  return { content: [{ type: "text", text: message }], details: {} };
}
