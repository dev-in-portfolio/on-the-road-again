// Monotonic request sequencer used to reject stale async search responses.
// Each request captures a sequence number from `next()`; when the response
// arrives it is applied only if `isCurrent(seq)` still holds. Issuing a newer
// request (or clearing a search) invalidates every older in-flight response so
// a slow, out-of-order reply can never replace newer results.

export class RequestSequencer {
  private current = 0;

  next(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(seq: number): boolean {
    return seq === this.current;
  }
}
