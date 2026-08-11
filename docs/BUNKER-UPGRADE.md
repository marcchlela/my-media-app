# chlela-bunker Upgrade Checklist

This checklist is prepared for the physical Ubuntu server. Do not execute it remotely without confirming the Kingston mount, a current backup, and physical recovery access. It never writes to or deletes media files.

## Before pulling

1. Connect to `chlela-bunker` and confirm the Kingston disk is mounted at the expected host path:

```bash
findmnt /srv/media/kingston
ls -ld /srv/media/kingston/Movies '/srv/media/kingston/TV Shows'
```

2. Confirm the existing deployment is healthy and record its commit:

```bash
curl --fail http://127.0.0.1:3000/health
cd <current-myflix-repository-directory>
git rev-parse HEAD
docker compose ps
```

Save that SHA as `PREVIOUS_COMMIT` in your upgrade notes.

3. Create a consistent backup. The safest full-data path is a brief stop:

```bash
sudo mkdir -p /srv/myflix/backups
docker compose stop myflix
sudo tar -C /srv/myflix -czf "/srv/myflix/backups/data-before-upgrade-$(date +%Y%m%d-%H%M%S).tgz" data
docker compose start myflix
```

Verify that the archive exists and is non-empty. Do not continue without it.

## Upgrade

4. Pull without rewriting local history and confirm the intended commit:

```bash
git status --short
git pull --ff-only
git rev-parse HEAD
```

Stop if there are unexpected local changes or if the SHA is not the release you intended.

5. Review `.env`. Keep existing secrets out of Git and retain at minimum:

```dotenv
TRANSCODE_ACCEL=auto
TRANSCODE_CONCURRENCY=1
TRANSCODE_FALLBACK_HEIGHT=720
SCAN_ON_STARTUP=true
```

Do not increase concurrency on the Pentium B940. Leave GPU device mapping commented out until `/dev/dri` and an actual FFmpeg hardware encode are verified. Consider leaving any broad intro-analysis job manual until CPU/temperature behavior is known.

6. Validate configuration and rebuild:

```bash
docker compose config
docker compose up -d --build
docker compose logs --tail=200 myflix
```

The Docker image remains Node-only plus server FFmpeg/Chromaprint packages. `mobile-client/` is excluded from its build context.

## Verify data and services

7. Confirm the additive database startup/migration completed without errors. Do not delete or recreate `/srv/myflix/data`.

8. Check health and admin:

```bash
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/api/capabilities
docker compose ps
```

Open `/desktop`, sign in, then open `/admin`. Verify users, catalog counts, favorites, poster choices, and existing progress.

9. Verify tools inside the container:

```bash
docker exec myflix ffmpeg -version
docker exec myflix ffprobe -version
docker exec myflix fpcalc -version
```

10. Inspect hardware without enabling it:

```bash
ls -la /dev/dri 2>/dev/null || true
lscpu
free -h
```

No `/dev/dri` result means there is no currently exposed Intel/AMD render device. Even if it exists, do not uncomment Compose device mapping until a controlled encoder test succeeds. Admin > System reports the container/server host statistics, not the development laptop.

## Conservative playback validation

11. Test an H.264/AAC MP4 in Original mode. Confirm Range seeking and that no HLS job starts.

12. Use one short, known-incompatible media sample already in the read-only library. Confirm:

- Direct is attempted first.
- A fatal Direct error requests `compatibility` HLS.
- Only one rendition at or below 720p is generated.
- Admin shows mode `hls-fallback`, its quality, user, position, and paused state.
- A failed fallback shows a final error and does not return to Direct automatically.

13. While the job runs, watch the server rather than starting other heavy jobs:

```bash
docker stats myflix
watch -n 2 'uptime; free -h'
```

If `lm-sensors` is already installed and configured, monitor `sensors`; do not install or configure it as part of the playback test.

14. Test **Auto** separately. It generates the full adaptive ladder and is intentionally more expensive than compatibility fallback.

15. Test one explicit quality. It should generate/reuse one `manual-<height>` cache and should never upscale the source.

16. Only after CPU, RAM, and temperature behavior is acceptable, run intro analysis for a small season from Admin. Verify FFmpeg and `fpcalc` jobs before considering broader analysis.

## Private remote access

17. After local playback is stable, follow [`TAILSCALE.md`](TAILSCALE.md): install Tailscale on the host, use private Serve HTTPS, never Funnel, and test from cellular.

18. Set the exact Serve URL in the native client's connection screen. Do not rebuild the app to change servers.

## Rollback

Application rollback first preserves the migrated data:

```bash
cd <current-myflix-repository-directory>
git switch --detach <PREVIOUS_COMMIT>
docker compose up -d --build
curl --fail http://127.0.0.1:3000/health
```

If the older application cannot read the upgraded database, stop immediately and restore the pre-upgrade archive:

```bash
docker compose stop myflix
sudo mv /srv/myflix/data "/srv/myflix/data-failed-$(date +%Y%m%d-%H%M%S)"
sudo tar -C /srv/myflix -xzf /srv/myflix/backups/<verified-pre-upgrade-archive>.tgz
sudo chown -R 1000:1000 /srv/myflix/data
git switch --detach <PREVIOUS_COMMIT>
docker compose up -d --build
```

Keep the failed data directory until the restored server and accounts are verified. Never run rollback commands against `/srv/media/kingston`.
