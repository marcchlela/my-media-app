# MyFlix Native Mobile

This is the real React Native iOS and Android client for MyFlix. It is an independent Expo SDK 54 project, not a WebView and not part of the server's Node dependency tree.

## Requirements

- Node.js 22 or newer
- Expo Go with SDK 54 support on the physical phone
- A reachable MyFlix server

Install and validate:

```bash
cd mobile-client
npm ci
npm run doctor
npm run typecheck
npm test
```

Expo Doctor must report SDK 54 compatibility. This project intentionally uses Expo 54, React Native 0.81, and React 19.1; do not run a broad Expo upgrade during this testing phase.

## Start with Expo Go

```bash
cd mobile-client
npm start
```

Keep the terminal and Metro process running while testing. The phone and development computer normally need to be on the same LAN unless both can reach Metro another way.

### Physical iPhone

1. Install Expo Go from the iOS App Store.
2. Run `npm start` in `mobile-client`.
3. Scan the QR code with the iPhone Camera or open the project from Expo Go.
4. On **Connect to MyFlix**, enter a reachable server such as `http://192.168.1.115:3000`.
5. Test connection, then sign in from Account.

The React Native project runs inside Expo Go during this phase. Its launcher icon is therefore the Expo Go icon, not the MyFlix icon. A future standalone build will use the prepared MyFlix identifier and icon. The current web app can independently be added to the iPhone Home Screen from Safari with MyFlix branding.

### Physical Android

1. Install Expo Go from Google Play.
2. Run `npm start` in `mobile-client`.
3. Scan the QR code from Expo Go.
4. Enter the reachable MyFlix server URL and test the connection.
5. Sign in and test the same account used by desktop/web.

Expo Go owns its installed launcher icon on Android as well. A future standalone APK/AAB will use the adaptive MyFlix artwork in `assets/`.

## Server connection

The first-run screen checks `/health`, `/api/capabilities`, and `/api/account/me`. The normalized URL and bearer session are stored separately with `expo-secure-store`; passwords are never persisted. Change the server from Account without reinstalling the app.

Supported examples:

```text
http://192.168.1.115:3000
https://chlela-bunker.<your-tailnet>.ts.net
```

The LAN IP and future Tailscale hostname are examples only and are not hardcoded. For private remote access, follow [`../docs/TAILSCALE.md`](../docs/TAILSCALE.md). Prefer HTTPS for a future standalone build. Expo Go is used for the current LAN HTTP test phase.

## Player test

1. Play an H.264/AAC MP4 and confirm Quality remains **Original**.
2. Stop on one device and confirm resume position on another signed-in client.
3. Test a short, known-incompatible file. A fatal Direct error should show **Preparing compatible stream**, generate one cached rendition, and begin HLS.
4. Confirm a brief buffer does not trigger HLS.
5. Select **Auto** to request the adaptive ladder.
6. Select an explicit quality to request one manual rendition.
7. Confirm an HLS failure shows a final error and does not loop back to Direct.
8. Test Skip Intro, Next Episode, fullscreen, seek, favorite sync, and embedded subtitle selection where the platform exposes tracks.

External subtitle URLs remain available through the typed API, but native track support depends on the source/container and platform. The browser client continues to support the existing WebVTT subtitle flow.

## Branding

The General icon is the default. Source artwork lives in `../branding/` and production PNGs live in `assets/`.

Select the Electric Lounge icon for configuration/export:

```powershell
$env:MYFLIX_ICON_VARIANT='electric'; npm start
```

```bash
MYFLIX_ICON_VARIANT=electric npm start
```

Use `general` or omit the variable to return to the default. Regenerate exports from source with:

```powershell
powershell -ExecutionPolicy Bypass -File ..\branding\export-icons.ps1
```

## Expo Go vs standalone

Expo Go provides free iOS/Android development testing without an Apple Developer Program, TestFlight, or store publishing. A standalone application is a separate future build/release step. Bundle identifiers, package identifiers, splash assets, adaptive icons, and iOS icon output are prepared now, but no standalone iOS build is claimed by this repository milestone.
