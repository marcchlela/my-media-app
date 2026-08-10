# MyFlix

MyFlix is a self-hosted media catalog with desktop web, mobile web, and Electron clients. The production server directly streams existing media files and does not perform video transcoding.

## Architecture

- The filesystem stores movies, episodes, and subtitle files.
- SQLite stores the catalog, accounts, sessions, favorites, poster overrides, watch progress, cached metadata, and availability state.
- Server clients receive stable media/show IDs. Absolute server paths are never returned by the library API.
- `ffprobe` runs only when a file is new or changed. It records duration, codecs, container, and dimensions.
- Streaming uses the original file with HTTP byte ranges. Unsupported browser codecs are reported by the player rather than transcoded.

`library.json` is not a server runtime source. On first startup, an existing file may be imported once to preserve IDs/metadata where practical. SQLite remains authoritative afterward.

## Modes

### Server mode

Run `npm run server` or Docker. The SQLite catalog under `DATA_DIR` is authoritative. Web clients use `/api/library`, and media streams use `/api/media/:id/stream`.

When Electron has `SHARED_SERVER_URL` configured, the server catalog is authoritative for every user, including administrators. Local import controls are disabled; use **Settings > Rescan Server Library**.

### Electron standalone mode

Run `npm start`. Without `SHARED_SERVER_URL`, the existing local Electron library, file picker, and local account behavior remain available.

## Requirements

- Node.js 22.5 or newer for `node:sqlite`.
- Docker Engine with Compose for the recommended Ubuntu deployment.
- No FFmpeg transcoding service or hardware acceleration is required.

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
7. Open Account and use **Rescan Library** if the startup scan has not finished.
8. After creating the intended accounts, set `ALLOW_SIGNUP=false` and run `docker compose up -d` again if you want closed registration.

Health information is available at `/health`. It contains catalog counts and source availability, but no paths or secrets.

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
- Administrators can start and monitor scans from web/mobile Account or Electron Settings.
- New and changed files are inspected; unchanged size/mtime entries are not re-probed.
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

The library works without TMDB. When configured, only exact, unambiguous automatic matches are accepted and results are stored in SQLite. Ambiguous media remains usable with filename-derived metadata.

## Backups and restore

Back up the complete directory:

```text
/srv/myflix/data
```

It contains the SQLite database and generated caches. Videos are not duplicated into this directory. For a consistent live backup, stop the container first or copy the SQLite database together with its `-wal` and `-shm` files.

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
