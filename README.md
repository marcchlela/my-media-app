# MyFlix

MyFlix is a self-hosted media catalog with desktop web, mobile web, and Electron clients. Original-quality direct play remains the default; the server can also generate reusable adaptive HLS quality variants on demand.

## Architecture

- The filesystem stores movies, episodes, and subtitle files.
- SQLite stores the catalog, accounts, sessions, favorites, poster overrides, watch progress, cached metadata, and availability state.
- Server clients receive stable media/show IDs. Absolute server paths are never returned by the library API.
- `ffprobe` runs only when a file is new or changed. It records duration, codecs, container, and dimensions.
- Original playback uses HTTP byte ranges with no conversion.
- Choosing Auto or a specific quality asks FFmpeg to generate cached HLS variants under `DATA_DIR/cache/hls`. The first request takes time; later playback reuses the cache until the source file changes.
- Chromaprint compares audio fingerprints across episodes in a season to detect recurring intros. Manual markers always remain authoritative.
- `/admin` is an administrator-only operations dashboard for library, streams, jobs, markers, storage, backups, and server health.

`library.json` is not a server runtime source. On first startup, an existing file may be imported once to preserve IDs/metadata where practical. SQLite remains authoritative afterward.

## Modes

### Server mode

Run `npm run server` or Docker. The SQLite catalog under `DATA_DIR` is authoritative. Web clients use `/api/library`, and media streams use `/api/media/:id/stream`.

`/desktop` and `/mobile` serve one responsive Electric Lounge client. Screen-size rules change navigation, poster sizing, rails, and dialogs without maintaining two separate feature implementations.

When Electron has `SHARED_SERVER_URL` configured, the server catalog is authoritative for every user, including administrators. Local import controls are disabled; use **Settings > Rescan Server Library**.

### Electron standalone mode

Run `npm start`. Without `SHARED_SERVER_URL`, the existing local Electron library, file picker, and local account behavior remain available.

## Requirements

- Node.js 22.5 or newer for `node:sqlite`.
- Docker Engine with Compose for the recommended Ubuntu deployment.
- The Docker image includes FFmpeg and Chromaprint. Direct play works without transcoding; adaptive quality and fingerprint detection require those tools.

## Ubuntu preparation

On `chlela-bunker`, prepare the persistent application directory:

```bash
sudo mkdir -p /srv/myflix/data
sudo chown -R 1000:1000 /srv/myflix/data
```

Mount the Kingston media disk read-only at `/srv/media/kingston`. Expected folders are:

```text
/srv/media/kingston/Movies
/srv/media/kingston/TV Shows
```

The Compose mount maps these to `/media/Movies` and `/media/TV Shows` inside the container.

## First deployment

1. Clone the repository on the server.
2. Create `.env` from `.env.example`.
3. Set `ADMIN_EMAILS` to your account email and optionally set `TMDB_API_KEY`.
4. Start MyFlix:

```bash
docker compose up -d --build
docker compose logs -f myflix
```

5. Open `http://192.168.1.115:3000/desktop`.
6. Sign up using an email listed in `ADMIN_EMAILS`.
7. Open `/admin` to monitor the startup scan, media analysis, and server status.
8. After creating the intended accounts, set `ALLOW_SIGNUP=false` and run `docker compose up -d` again if you want closed registration.

Health information is available at `/health`. It contains catalog counts and source availability, but no paths or secrets.

### Adaptive quality and hardware acceleration

`TRANSCODE_ACCEL=auto` prefers a usable hardware encoder and falls back to `libx264`. `TRANSCODE_CONCURRENCY=1` protects a small homelab from running several expensive encodes simultaneously. Adaptive outputs are generated once, cached, and reused; this is not continuous live transcoding on every playback.

For Intel or AMD graphics on Linux, expose the render device by uncommenting the `/dev/dri` device mapping in `compose.yaml`. Confirm the result under **Admin > System**. NVIDIA requires the NVIDIA container runtime in addition to FFmpeg encoder support.

## Media naming

Movies can be directly inside the movie directory or nested in folders:

```text
Movies/Rounders.mp4
Movies/Sound.of.Metal.mp4
Movies/The Batman.mp4
Movies/Subtitles/Interstellar.English-Subtitles.srt
```

TV episodes must contain an `SxxExx` code. Both layouts work:

```text
TV Shows/I Will Find You/Season 1/I.Will.Find.You.S01E01.mp4
TV Shows/Off Campus/Off.Campus.S01E01.mp4
```

Multi-episode names such as `Show.Name.S03E24-E25.mkv` are supported. Season directories are optional.

Subtitle matching considers same-directory names, nearby `Subtitles` folders, normalized names, and matching episode codes. `.srt` files are converted to WebVTT in `/data/cache/subtitles`; source subtitle files remain unchanged.

## Rescanning and unavailable media

- Startup scanning is controlled by `SCAN_ON_STARTUP`.
- Administrators can start and monitor scans from `/admin`, web Settings, or Electron Settings.
- New and changed files are inspected; unchanged size/mtime entries are not re-probed.
- Unchanged entries that are missing TMDB data can be enriched without running `ffprobe` again.
- Missing files are marked unavailable, never automatically deleted.
- If a configured root is missing or unexpectedly empty, the scan fails safely and preserves its catalog.
- Reconnect the USB and rescan to restore availability.

The media USB is mounted read-only. MyFlix never renames, deletes, or writes video files.

## Accounts and security

- Accounts are optional by default: anonymous users can browse and stream; signed-in users gain progress/favorites.
- Set `REQUIRE_AUTH=true` to require login for the catalog and streams.
- Passwords use Node's `crypto.scrypt`; new passwords require at least 10 characters.
- Sessions expire and stale sessions are pruned.
- Administrator assignment comes only from `ADMIN_EMAILS`; the first random signup is not automatically promoted.
- Cross-origin requests are rejected unless their full origin is listed in `ALLOWED_ORIGINS`.
- Keep `ENABLE_LEGACY_PATH_ROUTES=false`.
- Set `COOKIE_SECURE=true` only when the site is served over HTTPS.

## TMDB

The library works without TMDB. When configured, automatic matching uses cleaned titles, optional filename years, title similarity, original titles, and an ambiguity margin. Strong matches are stored in SQLite; uncertain results remain unmatched instead of accepting the first search result.

Administrators can use **Fix Metadata** from a movie or show details page to search TMDB, inspect candidate posters/titles/years, and lock the correct match. **Clear Manual Match** restores filename-derived metadata, while **Retry Automatic Match** runs the conservative matcher again. Correcting a show also refreshes metadata for its associated episodes.

The Account page's **Library Management** panel provides **Refresh Missing Metadata**. This background job only targets catalog rows missing a TMDB match or poster. It does not scan video contents, run `ffprobe`, or modify media files.

Catalog schema version 7 adds marker confidence and analysis provenance, subtitle visibility controls, and account-scoped media suggestions. The migration is additive and preserves media IDs, accounts, progress, favorites, poster overrides, and existing metadata.

Administrators can open **Settings > Library Management** or `/admin` to rescan, refresh metadata, hide or remove catalog entries without deleting media files, manage subtitles, and review intro/credits markers. Rescans read named chapters, reuse season timing templates, conservatively estimate credits, and schedule season-level audio fingerprint analysis. Manual timings remain authoritative. Users can edit their profile name, change their password, view account-scoped statistics, suggest exact TMDB titles, and choose a per-account TMDB or uploaded custom poster from movie/show details.

## Backups and restore

Back up the complete directory:

```text
/srv/myflix/data
```

It contains the SQLite database and generated caches. Videos are not duplicated into this directory. **Admin > Storage** can create a consistent SQLite snapshot while MyFlix is running; a full filesystem backup can still be made while the container is stopped.

Restore by stopping MyFlix, replacing `/srv/myflix/data` from backup, ensuring UID 1000 can write it, and starting the container again.

## Updating

```bash
git pull
docker compose up -d --build
docker image prune
```

Schema migrations run automatically and preserve existing catalog/account data.

## Local development and tests

```bash
npm ci
npm test
npm run server
```

The test suite uses Node's built-in test runner and temporary media directories. It does not alter real media.
