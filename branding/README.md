# MyFlix Branding

- `icon-general.svg` is the default cross-theme MyFlix mark: a cinematic ribbon M with film-edge details.
- `icon-electric-lounge.svg` is the Electric Lounge edition: a burgundy admission ticket, screening room, brass marquee, and lounge seat.
- `adaptive-foreground.svg`, `adaptive-monochrome.svg`, and `splash-icon.svg` are production source assets for the Expo client.

Run `powershell -ExecutionPolicy Bypass -File branding/export-icons.ps1` from the repository root to regenerate PNG exports. The script uses an installed Microsoft Edge browser as a standards-compliant SVG renderer.

Web icons use General by default. Set `$env:MYFLIX_WEB_ICON_VARIANT='electric'` before running the script to export the Electric Lounge edition, then unset it and rerun to restore General.
