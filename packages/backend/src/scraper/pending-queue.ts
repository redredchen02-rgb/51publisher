type QueueItem<T> = {
  fn: () => T;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
};

export class WriteQueue {
  private queue: QueueItem<any>[] = [];
  private active = false;

  enqueue<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.drain();
    });
  }

  private drain() {
    if (this.active) return;
    this.active = true;
    const next = this.queue.shift();
    if (!next) {
      this.active = false;
      return;
    }
    try {
      next.resolve(next.fn());
    } catch (e) {
      next.reject(e instanceof Error ? e : new Error(String(e)));
    }
    setImmediate(() => {
      this.active = false;
      this.drain();
    });
  }
}

export const pendingWriteQueue = new WriteQueue();
