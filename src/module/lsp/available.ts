import type { ServerStatus } from "./manager";
import { markedFolders } from "./util/lookup";

/** Languages whose installed, enabled server has a root in this project. */
export function availableLanguages(statuses: readonly ServerStatus[], cwd: string): string[] {
  return statuses
    .filter(
      (status) => status.path !== undefined && status.on && markedFolders(cwd, status.spec.rootMarkers).length > 0,
    )
    .map((status) => status.spec.language);
}
