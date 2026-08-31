/**
 * Guarantees at most ONE in-flight prompt per site at any given time.
 * Any additional calls for the same site are queued (FIFO) and run only
 * after the previous one for that site completes. Different sites run
 * fully concurrently (bounded elsewhere by the browser pool's page count).
 */
export class SiteQueueCoordinator {
  constructor() {
    this._locks = new Map();   // siteKey -> boolean (currently running)
    this._queues = new Map();  // siteKey -> array of { taskFn, resolve, reject }
    this._stats = new Map();   // siteKey -> { queued, running, completed, failed }
  }

  _stat(siteKey) {
    if (!this._stats.has(siteKey)) {
      this._stats.set(siteKey, { queued: 0, running: 0, completed: 0, failed: 0 });
    }
    return this._stats.get(siteKey);
  }

  /**
   * Enqueues taskFn for siteKey. Resolves/rejects with taskFn's own result.
   */
  run(siteKey, taskFn) {
    if (!siteKey) return Promise.reject(new Error('[SiteQueueCoordinator] siteKey is required'));
    const stat = this._stat(siteKey);
    stat.queued += 1;

    return new Promise((resolve, reject) => {
      if (!this._queues.has(siteKey)) this._queues.set(siteKey, []);
      this._queues.get(siteKey).push({ taskFn, resolve, reject });
      this._drain(siteKey);
    });
  }

  isBusy(siteKey) {
    return !!this._locks.get(siteKey);
  }

  queueLength(siteKey) {
    return this._queues.get(siteKey)?.length ?? 0;
  }

  getStats(siteKey) {
    return { ...this._stat(siteKey) };
  }

  async _drain(siteKey) {
    if (this._locks.get(siteKey)) return; // a task for this site is already running
    const queue = this._queues.get(siteKey);
    if (!queue || queue.length === 0) return;

    const { taskFn, resolve, reject } = queue.shift();
    const stat = this._stat(siteKey);
    stat.queued = Math.max(0, stat.queued - 1);
    stat.running += 1;
    this._locks.set(siteKey, true);

    try {
      const result = await taskFn();
      stat.completed += 1;
      resolve(result);
    } catch (err) {
      stat.failed += 1;
      reject(err);
    } finally {
      stat.running = Math.max(0, stat.running - 1);
      this._locks.set(siteKey, false);
      queueMicrotask(() => this._drain(siteKey));
    }
  }
}

export const siteQueue = new SiteQueueCoordinator();
