import type { ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";

/**
 * The modules' tool renderer resolvers, by module name. pi can't unregister a resolver, so `MyPi` registers one, once
 * per extension load, that asks the current session's chain; each session's modules set theirs again in `init()`.
 * Quiet is the first user; a layout theme (the roadmap's "Theme picker") comes next.
 */
export class RendererChain {
  private readonly resolvers = new Map<string, ToolRendererResolver>();

  /** Sets the resolver under `name`, or removes it with `undefined`. */
  set(name: string, resolver: ToolRendererResolver | undefined): void {
    if (resolver === undefined) {
      this.resolvers.delete(name);
      return;
    }

    this.resolvers.set(name, resolver);
  }

  /** The renderers for `toolName`: each resolver in the order set, wrapping the ones after it, then pi's `next`. */
  resolve(toolName: string, next: () => ToolRenderers | undefined): ToolRenderers | undefined {
    const chained = [...this.resolvers.values()].reduceRight<() => ToolRenderers | undefined>(
      (rest, resolver) => () => resolver(toolName, rest),
      next,
    );
    return chained();
  }
}
