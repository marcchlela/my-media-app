# MyFlix Native Mobile

This is MyFlix's private React Native iOS and Android client. It is an independent Expo SDK 54 project, not a WebView and not part of the server's Node dependency tree. MyFlix is a private self-hosted home media system and has no App Store, Google Play, TestFlight, EAS release, analytics, advertising, or subscription roadmap.

The normal native runtime is Expo Go. On iPhone, the primary independent Home Screen installation is the responsive web app through Safari **Add to Home Screen**. Remote server access is private through Tailscale.

## Requirements

- Node.js 22 or newer
- Expo Go with SDK 54 support on the physical phone
- A reachable MyFlix server for real-data testing, or explicitly enabled development demo mode

Install and validate:

```bash
cd mobile-client
npm ci
npm run doctor
npm run typecheck
npm test
```

Expo Doctor must report SDK 54 compatibility. This project intentionally stays on Expo 54, React Native 0.81, and React 19.1; do not run a broad Expo upgrade.

The native modules currently used are Expo Router, `expo-video`, `expo-secure-store`, fonts/icons, splash screen, system UI, linking, screens, and safe-area context. All are supported by Expo Go for the behavior used here. MyFlix does not enable background audio, Picture in Picture, biometric SecureStore access, or another feature requiring a custom native build. Basic SecureStore key/value storage works in Expo Go; its biometric `requireAuthentication` limitation does not apply because MyFlix does not use that option.

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
4. On **Connect to MyFlix**, enter a reachable private server such as `http://192.168.x.x:3000`.
5. Test connection, then sign in from Account.

The React Native project runs inside Expo Go, so its launcher icon is the Expo Go icon rather than the MyFlix icon. The responsive web app can independently be added to the iPhone Home Screen from Safari with MyFlix branding.

### Physical Android

1. Install Expo Go from Google Play.
2. Run `npm start` in `mobile-client`.
3. Scan the QR code from Expo Go.
4. Enter the reachable MyFlix server URL and test the connection.
5. Sign in and test the same account used by desktop/web.

Expo Go owns its installed launcher icon on Android as well. A private Android APK is outside the normal workflow and should only be prepared if explicitly requested.

## Development demo mode

Demo mode makes the complete native UI testable without `chlela-bunker`. It contains fictional titles, in-app generated title cards, temporary favorites/progress/account state, and an interactive player preview. It contains no real posters, copyrighted media, or video files.

From `mobile-client`:

```bash
npm ci
npm run start:demo
```

The launcher sets `EXPO_PUBLIC_MYFLIX_DEMO=true`. Runtime code additionally requires Expo's `__DEV__` flag, so the demo button is absent from normal exports and normal private-server use. You can also copy `.env.example` to `.env.local`, set the value to `true`, and run `npm start`.

To inspect the UI while away from the home server:

1. Put the phone and development computer on the same network.
2. Install/open Expo Go with SDK 54 support.
3. Run `npm run start:demo` in this directory.
4. Scan the Metro QR code with the iPhone Camera or Expo Go on Android.
5. On **Connect to MyFlix**, choose **Explore Demo Library**.
6. Inspect Home, Search, Library, Account, movie/show details, seasons, episodes, favorites, progress, and the player preview.

If the phone cannot reach Metro over the current LAN, retry with `npm run start:demo -- --tunnel`. Expo's tunnel may require a one-time helper download. An Expo account is not required by MyFlix for this local pass.

## Server connection

The first-run screen checks `/health`, `/api/capabilities`, and `/api/account/me`. The normalized URL and bearer session are stored separately with `expo-secure-store`; passwords are never persisted. Change the server from Account without reinstalling the app.

Supported examples:

```text
http://192.168.x.x:3000
https://chlela-bunker.<your-tailnet>.ts.net
```

The LAN IP and Tailscale hostname are examples only and are not hardcoded. For private remote access, follow [`../docs/TAILSCALE.md`](../docs/TAILSCALE.md). Use the exact private Tailscale Serve HTTPS URL once configured.

Expo Go uses the Expo Go application's native networking configuration, not the `ios.infoPlist` values in this project. LAN HTTP such as `http://192.168.x.x:3000` is retained for at-home Expo Go testing. The project config uses the narrower `NSAllowsLocalNetworking` declaration instead of globally disabling App Transport Security; long-term remote access uses private Tailscale HTTPS.

## Player test

1. Play an H.264/AAC MP4 and confirm Quality remains **Original**.
2. Stop on one device and confirm resume position on another signed-in client.
3. Test a short, known-incompatible file. A fatal Direct error should show **Preparing compatible stream**, generate one cached rendition, and begin HLS.
4. Confirm a brief buffer does not trigger HLS.
5. Select **Auto** to request the adaptive ladder.
6. Select an explicit quality to request one manual rendition.
7. Confirm an HLS failure shows a final error and does not loop back to Direct.
8. Test Skip Intro, Next Episode, fullscreen, seek, favorite sync, embedded tracks, and MyFlix WebVTT subtitle overlays.

Embedded native track availability still depends on the source/container and platform. Separate MyFlix subtitles are fetched as authenticated WebVTT and rendered by the JavaScript player overlay, which remains Expo-Go-compatible.

## Branding

The General icon is the default project artwork. Source artwork lives in `../branding/` and generated PNGs live in `assets/`.

Select the Electric Lounge artwork for local configuration/export:

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

## Private runtime boundaries

Expo Go is the supported native path for this project. The bundle/package identifiers remain because Expo configuration expects stable project identity; they do not imply store submission. The MyFlix icons are used for project branding, splash artwork, web Add to Home Screen, and only a private Android APK if one is explicitly requested later.

`npm run export` is a local static-bundle validation command. It does not publish MyFlix, create an EAS project, or deploy an update.
