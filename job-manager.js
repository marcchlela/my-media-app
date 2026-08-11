const crypto = require('crypto');

class JobManager {
  constructor(options = {}) {
    this.jobs = new Map();
    this.history = [];
    this.maxHistory = options.maxHistory || 100;
  }

  start(type, label, runner, metadata = {}) {
    const id = `job_${crypto.randomUUID().replace(/-/g, '')}`;
    const controller = new AbortController();
    const job = {
      id,
      type,
      label,
      state: 'queued',
      progress: 0,
      message: 'Queued',
      metadata,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      controller,
    };
    this.jobs.set(id, job);
    const update = (values = {}) => {
      if (Number.isFinite(values.progress)) values.progress = Math.max(0, Math.min(100, values.progress));
      Object.assign(job, values);
    };
    Promise.resolve().then(async () => {
      update({ state: 'running', startedAt: Date.now(), message: 'Running' });
      try {
        const result = await runner({ update, signal: controller.signal, job: this.publicJob(job) });
        update({ state: 'completed', progress: 100, message: 'Completed', result: result || null });
      } catch (err) {
        update({
          state: controller.signal.aborted ? 'cancelled' : 'failed',
          message: controller.signal.aborted ? 'Cancelled' : 'Failed',
          error: err.message || 'Job failed.',
        });
      } finally {
        job.finishedAt = Date.now();
        this.history.unshift(this.publicJob(job));
        this.history = this.history.slice(0, this.maxHistory);
        this.jobs.delete(id);
      }
    });
    return this.publicJob(job);
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.controller.abort();
    return true;
  }

  publicJob(job) {
    const { controller, ...publicValues } = job;
    return JSON.parse(JSON.stringify(publicValues));
  }

  snapshot() {
    return {
      active: Array.from(this.jobs.values()).map((job) => this.publicJob(job)),
      recent: this.history.slice(),
    };
  }
}

module.exports = { JobManager };
