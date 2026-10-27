/** A body that hands out `chunks` one per read, and records whether it was read or cancelled. */
export function trackedStream(chunks: Uint8Array[]) {
  const state = { reads: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[state.reads++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}
