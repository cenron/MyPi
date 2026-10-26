/**
 * MyPi's channels on the event bus (`events.ts`), and what each carries: the contracts between parts. Each says who
 * publishes or asks and who listens or answers. The one file that changes when a feature adds or drops a channel:
 * removing a channel makes every `ask` and `answer` on it fail to typecheck, which lists the code it leaves behind.
 */

/** A problem a diagnostics source found in a file, 1-based, such as a type error. */
export type Duplicate = { name: string; file: string; line: number; elsewhere: { file: string; line: number } };

export type Problem = {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  /** Where it came from, such as `ts 2322`. */
  origin?: string;
};

/**
 * Every notice MyPi publishes, by channel, with what it carries. One place to see what parts tell each other; each
 * says who publishes and who listens.
 */
export type MyPiNotices = {
  /** How many jobs are running. `JobManager` publishes; `Session` updates the below-editor jobs line. */
  jobs: number;
};

/** The subset todo shares with the done check; completed tasks do not block a Build run. */
export type OpenTask = { id: string; subject: string; status: "pending" | "in_progress" };

/**
 * Every question MyPi asks, by channel: what the asker sends and what each listener answers. Each says who asks and
 * who answers.
 */
export type MyPiQuestions = {
  /** Plan or Build. The done check and subagents ask; plan-build answers. */
  mode: { request: undefined; answer: "plan" | "build" };
  /** The problems in `files`. The done check asks; the LSP module answers. */
  diagnostics: { request: { files: readonly string[]; signal?: AbortSignal }; answer: Problem[] };
  /** New top-level names already declared elsewhere in changed files. The done check asks; the LSP module answers. */
  duplicates: { request: { files: readonly string[]; signal?: AbortSignal }; answer: Duplicate[] };
  /** Tasks still open at the end of a Build run. The done check asks; todo answers. */
  openTasks: { request: undefined; answer: OpenTask[] };
  /** The project's check commands the user already approved on this machine. Subagents ask; the done check answers. */
  checkCommands: { request: undefined; answer: string[] };
};
