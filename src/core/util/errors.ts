/** Turns any thrown value into a message: an `Error`'s `message`, otherwise `String(value)`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for a Node system error, which carries a `code` such as `ENOENT`. */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
