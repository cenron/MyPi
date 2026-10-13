export type CommandExec = (
  args: string[],
) => Promise<string | undefined> | string;

export type Command = {
  name: string;
  description: string;
  execute: CommandExec;
};
