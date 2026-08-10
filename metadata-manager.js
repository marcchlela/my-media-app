const {
  applyAdminMetadata,
  clearAdminMetadata,
  getEpisodesForShow,
  getMetadataTarget,
  listMissingMetadataTargets,
  updateEpisodeMetadata,
} = require('./media-store');
const { createTmdbService } = require('./tmdb-service');

function emptyStatus() {
  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    targeted: 0,
    matched: 0,
    unmatched: 0,
    failed: 0,
    episodesUpdated: 0,
    errors: [],
  };
}

class MetadataManager {
  constructor(options = {}) {
    this.tmdb = options.tmdb || createTmdbService();
    this.status = emptyStatus();
    this.activeRefresh = null;
  }

  getStatus() {
    return JSON.parse(JSON.stringify(this.status));
  }

  async search(targetType, targetId, query = '') {
    const target = getMetadataTarget(targetType, targetId);
    if (!target) throw new Error('Metadata target was not found.');
    if (!this.tmdb.configured) throw new Error('TMDB is not configured.');
    const initialQuery = String(query || target.lookup_title || target.filename || target.source_title || target.title || '').trim();
    return {
      query: initialQuery,
      results: await this.tmdb.search(targetType, initialQuery),
    };
  }

  async refreshEpisodes(showId, showTmdbId) {
    if (!showTmdbId) return { updated: 0, failed: 0 };
    let updated = 0;
    let failed = 0;
    for (const episode of getEpisodesForShow(showId)) {
      if (episode.metadata_locked) continue;
      try {
        const metadata = await this.tmdb.enrichEpisode(
          showTmdbId,
          episode.season_number,
          episode.episode_number
        );
        if (metadata && updateEpisodeMetadata(episode.id, metadata)) updated += 1;
      } catch (err) {
        failed += 1;
      }
    }
    return { updated, failed };
  }

  async refreshTarget(targetType, targetId, options = {}) {
    const target = getMetadataTarget(targetType, targetId);
    if (!target) return { state: 'failed', error: 'Metadata target was not found.' };
    if (target.metadata_locked && !options.force) return { state: 'locked' };
    if (!this.tmdb.configured) return { state: 'failed', error: 'TMDB is not configured.' };
    try {
      const sourceTitle = target.lookup_title || target.filename || target.source_title || target.title;
      const metadata = targetType === 'show'
        ? await this.tmdb.enrichShow(sourceTitle)
        : await this.tmdb.enrichMovie(sourceTitle);
      if (!metadata) return { state: 'unmatched' };
      applyAdminMetadata(targetType, targetId, metadata, { locked: false });
      const episodes = targetType === 'show'
        ? await this.refreshEpisodes(targetId, metadata.tmdbId)
        : { updated: 0, failed: 0 };
      return { state: 'matched', metadata, episodes };
    } catch (err) {
      return { state: 'failed', error: err.message || 'Metadata refresh failed.' };
    }
  }

  async applyManualMatch(targetType, targetId, tmdbId) {
    const target = getMetadataTarget(targetType, targetId);
    if (!target) throw new Error('Metadata target was not found.');
    if (!this.tmdb.configured) throw new Error('TMDB is not configured.');
    const metadata = await this.tmdb.fetchMetadata(targetType, tmdbId);
    if (!metadata) throw new Error('TMDB metadata was not found.');
    applyAdminMetadata(targetType, targetId, metadata, { locked: true });
    const episodes = targetType === 'show'
      ? await this.refreshEpisodes(targetId, metadata.tmdbId)
      : { updated: 0, failed: 0 };
    return { metadata, episodes };
  }

  clearManualMatch(targetType, targetId) {
    return clearAdminMetadata(targetType, targetId);
  }

  async retryAutomatic(targetType, targetId) {
    if (!clearAdminMetadata(targetType, targetId)) {
      return { state: 'failed', error: 'Metadata target was not found.' };
    }
    return this.refreshTarget(targetType, targetId, { force: true });
  }

  startMissingRefresh() {
    if (this.status.running) return { started: false, status: this.getStatus() };
    this.status = { ...emptyStatus(), running: true, startedAt: Date.now() };
    this.activeRefresh = this.runMissingRefresh();
    return { started: true, status: this.getStatus() };
  }

  async runMissingRefresh() {
    try {
      if (!this.tmdb.configured) throw new Error('TMDB is not configured.');
      const targets = listMissingMetadataTargets();
      this.status.targeted = targets.length;
      for (const target of targets) {
        const result = await this.refreshTarget(target.target_type, target.id);
        if (result.state === 'matched') {
          this.status.matched += 1;
          this.status.episodesUpdated += result.episodes?.updated || 0;
          this.status.failed += result.episodes?.failed || 0;
        } else if (result.state === 'unmatched' || result.state === 'locked') {
          this.status.unmatched += 1;
        } else {
          this.status.failed += 1;
          if (result.error) this.status.errors.push(result.error);
        }
      }
    } catch (err) {
      this.status.failed += 1;
      this.status.errors.push(err.message || 'Metadata refresh failed.');
    } finally {
      this.status.running = false;
      this.status.finishedAt = Date.now();
      this.activeRefresh = null;
    }
    return this.getStatus();
  }

  async waitForIdle() {
    if (this.activeRefresh) await this.activeRefresh;
    return this.getStatus();
  }
}

module.exports = { MetadataManager, emptyStatus };
