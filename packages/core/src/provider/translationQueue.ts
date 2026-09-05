import type { TranslationPriority } from './types';

interface QueueTask<T> {
  key: string;
  priority: TranslationPriority;
  sequence: number;
  group?: string | undefined;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export class TranslationQueue {
  private readonly concurrency: number;
  private activeCount = 0;
  private sequence = 0;
  private readonly pending: QueueTask<unknown>[] = [];
  private readonly shared = new Map<string, Promise<unknown>>();

  constructor(concurrency = 2) {
    this.concurrency = Math.max(1, Math.floor(concurrency));
  }

  enqueue<T>(
    key: string,
    priority: TranslationPriority,
    run: () => Promise<T>,
    group?: string,
  ): Promise<T> {
    const existing = this.shared.get(key);
    if (existing) {
      if (priority === 'current') {
        const pendingTask = this.pending.find((task) => task.key === key);
        if (pendingTask) pendingTask.priority = 'current';
        this.sortPending();
      }
      return existing as Promise<T>;
    }

    let resolveTask!: (value: T | PromiseLike<T>) => void;
    let rejectTask!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    this.shared.set(key, promise);
    this.pending.push({
      key,
      priority,
      sequence: this.sequence,
      group,
      run,
      resolve: resolveTask as QueueTask<unknown>['resolve'],
      reject: rejectTask,
    });
    this.sequence += 1;
    this.sortPending();
    this.drain();
    return promise;
  }

  promoteGroup(group: string): number {
    let promoted = 0;
    for (const task of this.pending) {
      if (task.group === group && task.priority !== 'current') {
        task.priority = 'current';
        promoted++;
      }
    }
    this.sortPending();
    return promoted;
  }

  private sortPending(): void {
    this.pending.sort((left, right) => {
      const leftPriority = left.priority === 'current' ? 0 : 1;
      const rightPriority = right.priority === 'current' ? 0 : 1;
      return leftPriority - rightPriority || left.sequence - right.sequence;
    });
  }

  private drain(): void {
    while (this.activeCount < this.concurrency) {
      const task = this.pending.shift();
      if (!task) return;
      this.activeCount += 1;
      void task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.activeCount -= 1;
          this.shared.delete(task.key);
          this.drain();
        });
    }
  }
}
