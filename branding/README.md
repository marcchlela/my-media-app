# MyFlix Branding

- `icons/icon-general.svg` is the editable default cross-theme MyFlix mark: a cinematic ribbon M with film-edge details.
- `icons/icon-electric-lounge.svg` is the editable Electric Lounge edition: a burgundy admission ticket, screening room, brass marquee, and lounge seat.
- `icons/icon-general-1024.png` and `icons/icon-electric-lounge-1024.png` are the full-size production exports of those concepts.

Run `powershell -ExecutionPolicy Bypass -File branding/export-icons.ps1` from the repository root to regenerate PNG exports. The script uses an installed Microsoft Edge browser as a standards-compliant SVG renderer.

Web icons use General by default. Set `$env:MYFLIX_WEB_ICON_VARIANT='electric'` before running the script to export the Electric Lounge edition, then unset it and rerun to restore General.
