const crypto = require('crypto');

class StreamManager {
  constructor(options = {}) {
    this.sessions = new Map();
    this.timeoutMs = options.timeoutMs || 45_000;
  }

  touch(input = {}, context = {}) {
    this.prune();
    const requestedId = String(input.sessionId || '');
    const sessionId = /^[a-z0-9_-]{12,80}$/i.test(requestedId)
      ? requestedId
      : `stream_${crypto.randomUUID().replace(/-/g, '')}`;
    const existing = this.sessions.get(sessionId);
    const now = Date.now();
    const session = {
      sessionId,
      userId: context.userId || null,
      userName: context.userName || 'Guest',
      ip: context.ip || '',
      mediaId: String(input.mediaId || existing?.mediaId || ''),
      title: String(input.title || existing?.title || 'Unknown title').slice(0, 180),
      mode: ['direct', 'hls-auto', 'hls-manual'].includes(input.mode) ? input.mode : (existing?.mode || 'direct'),
      quality: String(input.quality || existing?.quality || 'Original').slice(0, 30),
      position: Math.max(0, Number(input.position) || 0),
      duration: Math.max(0, Number(input.duration) || 0),
      paused: !!input.paused,
      startedAt: existing?.startedAt || now,
      lastSeenAt: now,
      bytesServed: existing?.bytesServed || 0,
    };
    this.sessions.set(sessionId, session);
    return { ...session };
  }

  addBytes(sessionId, bytes) {
    const session = this.sessions.get(sessionId);
    if (session) session.bytesServed += Math.max(0, Number(bytes) || 0);
  }

  close(sessionId) {
    return this.sessions.delete(String(sessionId || ''));
  }

  prune() {
    const threshold = Date.now() - this.timeoutMs;
    for (const [id, session] of this.sessions) {
      if (session.lastSeenAt < threshold) this.sessions.delete(id);
    }
  }

  snapshot() {
    this.prune();
    return Array.from(this.sessions.values()).sort((a, b) => b.startedAt - a.startedAt);
  }
}

module.exports = { StreamManager };
