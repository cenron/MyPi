/** The modules' system prompt sections, by module name; `apply` writes them into each run's sections. */
export class PromptManager {
  private readonly sections = new Map<string, string>();

  /** Sets the section under `name`, or removes it with `undefined`. */
  set(name: string, prompt: string | undefined): void {
    if (prompt === undefined) {
      this.sections.delete(name);
      return;
    }

    this.sections.set(name, prompt);
  }

  /** Writes each section into `target` as `mypi-<name>`, leaving pi's and other extensions' sections alone. */
  apply(target: Record<string, string>): void {
    for (const [name, prompt] of this.sections) {
      target[`mypi-${name}`] = prompt;
    }
  }
}
