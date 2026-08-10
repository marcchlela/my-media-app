# MYFLIX Cinema Designs v2

This version fixes the main problem from v1: the cinema room details are not just in the preview image anymore.
Each design includes real local assets in its `assets/` folder and the CSS uses them directly.

## Folders

- `design-1-electric-lounge/` — warm boutique cinema lounge: wall panel PNG, lamp mood, framed posters with hanging picture lights.
- `design-2-indie-projector/` — dark indie cinema: projector/camera beam PNG, moody lounge corner, minimal poster gallery.
- `design-3-private-screening/` — modern private screening room: acoustic panel PNG, projector beam, lightbox-style posters.

Each folder contains:

```txt
index.html
styles.css
app.js
assets/
```

## Electron usage

Example:

```js
mainWindow.loadFile('myflix-cinema-designs-v2/design-1-electric-lounge/index.html')
```

## TMDB posters

In `app.js`, replace this:

```js
poster: ''
```

with this:

```js
poster: 'https://image.tmdb.org/t/p/w500/YOUR_POSTER_PATH.jpg'
```

The frame, light, border, texture, projector, and cinema-room style will stay around your real posters.

## Notes

- The assets are intentionally local PNG files so the designs work offline in Electron.
- You can edit the PNG assets, colors, or CSS without needing any framework.
- No React required. Vanilla HTML/CSS/JS only.
