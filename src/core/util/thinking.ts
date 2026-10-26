import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** One of pi's thinking levels, taken from pi's context type: the package that declares it isn't a MyPi dependency. */
export type ThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;

/** pi's thinking levels. pi exports the type but not the list, and saved state and agent files need checking. */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ThinkingLevel[];

/** True when `value` is one of pi's thinking levels; checks a level read from saved state. */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly unknown[]).includes(value);
}
