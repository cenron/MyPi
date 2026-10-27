import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { MyPiNotices, MyPiQuestions } from "./channels";
import { errorMessage } from "./util/errors";

/** One listener's answer to a question, or why it failed, with the module it came from. */
export type Answer<T> = { from: string; kind: "answer"; value: T } | { from: string; kind: "failed"; error: string };

/** What an asked question carries on the bus: the request, and the list every answering listener adds to. */
type Asked<K extends keyof MyPiQuestions> = {
  request: MyPiQuestions[K]["request"];
  answers: { from: string; answer: Promise<MyPiQuestions[K]["answer"]> }[];
};

/** pi's bus is shared by every extension, so MyPi's channels carry its name. */
const NOTICE_PREFIX = "mypi:";
const QUESTION_PREFIX = "mypi:ask:";

/** Tells every listener on `channel`, through pi's bus. Nothing comes back. */
export function publish<K extends keyof MyPiNotices>(events: EventBus, channel: K, notice: MyPiNotices[K]): void {
  events.emit(NOTICE_PREFIX + channel, notice);
}

/** Calls `handler` with each notice on `channel`. Returns a function that stops it; pi also stops it on `/reload`. */
export function subscribe<K extends keyof MyPiNotices>(
  events: EventBus,
  channel: K,
  handler: (notice: MyPiNotices[K]) => void,
): () => void {
  // A cast at the boundary: MyPi's channels are written only through `publish`.
  return events.on(NOTICE_PREFIX + channel, (data) => handler(data as MyPiNotices[K]));
}

/**
 * Asks every listener on `channel` and waits for all their answers. Each answering listener adds its answer to the
 * request as it's emitted: Node's `EventEmitter`, which pi's bus is, calls every listener before `emit` returns, so
 * the list is complete then. Empty when nobody answers. A listener that fails comes back as `failed`, for the asker
 * to report.
 */
export async function ask<K extends keyof MyPiQuestions>(
  events: EventBus,
  channel: K,
  request: MyPiQuestions[K]["request"],
): Promise<Answer<MyPiQuestions[K]["answer"]>[]> {
  const asked: Asked<K> = { request, answers: [] };
  events.emit(QUESTION_PREFIX + channel, asked);

  return Promise.all(
    asked.answers.map(async ({ from, answer }): Promise<Answer<MyPiQuestions[K]["answer"]>> => {
      try {
        return { from, kind: "answer", value: await answer };
      } catch (error) {
        return { from, kind: "failed", error: errorMessage(error) };
      }
    }),
  );
}

/**
 * Every answer's items, in order. Each listener that failed goes to `onFailure`, so the asker can tell the user; a
 * failed answer never just disappears.
 */
export function answeredItems<T>(
  answers: readonly Answer<readonly T[]>[],
  onFailure: (from: string, error: string) => void,
): T[] {
  for (const answer of answers) {
    if (answer.kind === "failed") onFailure(answer.from, answer.error);
  }
  return answers.flatMap((answer) => (answer.kind === "answer" ? [...answer.value] : []));
}

/** Answers every question on `channel` as module `from`. Returns a function that stops it; pi also stops it on `/reload`. */
export function answer<K extends keyof MyPiQuestions>(
  events: EventBus,
  channel: K,
  from: string,
  handler: (request: MyPiQuestions[K]["request"]) => Promise<MyPiQuestions[K]["answer"]> | MyPiQuestions[K]["answer"],
): () => void {
  return events.on(QUESTION_PREFIX + channel, (data) => {
    // A cast at the boundary: MyPi's questions are emitted only through `ask`.
    const asked = data as Asked<K>;
    // Added now, while `ask`'s emit is still running; the handler itself runs after.
    asked.answers.push({ from, answer: Promise.resolve(asked.request).then(handler) });
  });
}
