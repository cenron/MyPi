/** One memory: its name (its path in the scope folder, without `.md`) and its description, if it has one. */
export type Memory = { readonly name: string; readonly description: string | undefined };

/** A scope's folder and its memories; `memories` is undefined when the folder can't be read. */
export type MemoryScope = { readonly dir: string; readonly memories: readonly Memory[] | undefined };
