import type { Command } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { COMMANDS_FILE, isApproved, readCommands } from "../project-commands";

/** `/done-check`: shows the project's check commands and whether they're approved on this machine. */
export function doneCheckCmd(): Command {
  return {
    info: {
      name: "done-check",
      description: "Show the done check's commands for this project, and if they're approved",
    },
    execute: (ctx) => commandsStatus(ctx.cwd),
  };
}

/** What `/done-check` says about the project in `cwd`. */
export async function commandsStatus(cwd: string): Promise<string> {
  let commands: string[] | undefined;
  try {
    commands = await readCommands(cwd);
  } catch (error) {
    return `Done check: ${errorMessage(error)}`;
  }

  if (commands === undefined || commands.length === 0) {
    return `Done check: no commands. List them in ${COMMANDS_FILE} as { "commands": ["npm test"] }.`;
  }

  const state = (await isApproved(cwd, commands))
    ? "approved"
    : "not approved yet: you're asked at the end of the next Build run that changes files";
  return [`Done check commands in ${COMMANDS_FILE} (${state}):`, ...commands.map((command) => `  ${command}`)].join(
    "\n",
  );
}
