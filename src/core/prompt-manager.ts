import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export class PromptManager {
  private readonly sections: Map<string, string> = new Map<string, string>();

  constructor(readonly _ctx: ExtensionContext) {}

  public set(name: string, prompt: string | undefined) {
    if (prompt === undefined) return this.sections.delete(name);

    return this.sections.set(name, prompt);
  }

  public apply(target: Record<string, string>) {
    for (const [name, prompt] of this.sections) {
      target[`mypi-${name}`] = prompt;
    }
  }
}
