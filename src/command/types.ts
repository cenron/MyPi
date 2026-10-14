export type CommandExec = (
  args: string[],
) => Promise<string | undefined> | string;
