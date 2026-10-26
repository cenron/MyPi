import type { Duplicate } from "#core/channels";

/** Most duplicate names one report lists; later reports can show more. */
export const MAX_REPORTED_DUPLICATES = 10;

/** Keeps only names not yet reported, remembering at most one report's worth. */
export function reportedDuplicates(
  duplicates: readonly Duplicate[],
  previouslyReported: ReadonlySet<string>,
): { duplicates: Duplicate[]; reported: Set<string> } {
  const reported = new Set(previouslyReported);
  const selected: Duplicate[] = [];
  let remembered = 0;
  for (const duplicate of duplicates) {
    if (reported.has(duplicate.name)) continue;
    selected.push(duplicate);
    if (remembered < MAX_REPORTED_DUPLICATES) {
      reported.add(duplicate.name);
      remembered++;
    }
  }
  return { duplicates: selected, reported };
}
