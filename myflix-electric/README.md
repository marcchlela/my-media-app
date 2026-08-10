# MyFlix — Electric Cinema Theme

A self-contained, no-build-step HTML/CSS/JS theme for your personal media app,
styled after the Electric Cinema in London: wood-paneled walls, brass picture
lights, framed posters, and warm ambient lighting.

No frameworks, no npm install — just open the HTML files in a browser.

---

## Folder structure

```
myflix-electric/
├── index.html        ← Lobby / Home page (the hero room you asked for)
├── movies.html        ← Full Movies library grid
├── series.html        ← Full Series library grid
├── detail.html        ← Movie/Series detail page (click any poster to reach it)
├── css/
│   ├── base.css        ← design tokens (colors, fonts, spacing) + resets
│   ├── layout.css       ← sidebar, topbar, page grid
│   ├── wall.css         ← wood wall background + hero "room" composition
│   ├── poster-frame.css   ← the 9-slice gold frame system (core component)
│   ├── cards.css        ← Continue Watching cards, library grid cards
│   └── detail.css       ← detail page specific styles
├── js/
│   ├── data.js         ← YOUR MOVIE/SERIES LIST — edit this file
│   ├── render.js        ← builds poster cards from data.js
│   ├── carousel.js       ← hero dot-indicator scroll syncing
│   └── detail.js        ← populates detail.html from the URL (?id=&type=)
├── assets/svg/         ← all generated cinema assets (see below)
└── posters/           ← put your real TMDB poster images here
```

---

## How to add your real posters (from TMDB or your own files)

1. Drop your poster image files into `/posters/` (e.g. `posters/inception.jpg`).
2. Open `js/data.js` and find the matching entry, e.g.:

   ```js
   { id: 'inception', title: 'Inception', year: 2010, genre: 'Sci-Fi',
     badges: [], progress: null, poster: null, gradient: '...' }
   ```

3. Change `poster: null` to `poster: 'posters/inception.jpg'`. That's it —
   the gold frame, lighting, and hover effects all keep working automatically
   because the frame is a CSS border, not a flattened image. Any poster size
   or aspect ratio will be cropped to fit via `object-fit: cover`.

If `poster` is left as `null`, the card falls back to a colored gradient
placeholder with the title overlaid — useful for testing layout before you've
imported real artwork.

To add a brand new movie or series, just add another object to the `MOVIES`
or `SERIES` array in `data.js` with a unique `id`. It will automatically
appear in the Lobby rails and the Movies grid, and become clickable through
to its own detail page at `detail.html?id=your-id&type=movie`.

---

## The asset system (how the frames/lights actually work)

**Important context:** these assets are hand-built SVG/vector graphics, not
AI-generated photographs. There was no image-generation tool available to
produce photoreal textures, so everything — the wood grain, the brass
fixtures, the light glow — is drawn with gradients and shapes in SVG. This
means every asset is fully editable as plain text/code, infinitely scalable,
and tiny in file size, but it has an illustrated look rather than a
photographic one.

### `gold-frame.svg` / `gold-frame.png` — the poster frame
This is a **9-slice border image**. It's a 240×240 image with a 20px border
region; the center is genuinely transparent (not just visually black), so it
composites correctly over any poster image or color underneath. It's applied
via CSS `border-image`, not as a background — see `.framed-poster` in
`poster-frame.css`. This is *why* you can drop in any poster size and the
frame still fits perfectly: the corners stay fixed-size and the edges stretch.

If you ever want to re-export this at a different resolution, regenerate the
PNG from the SVG and keep the `border-image-slice: 20` value in
`poster-frame.css` matching the SVG's border-region proportions (20px out of
240px, i.e. ~8.3%).

### `picture-light.svg` — the brass light fixture above each poster
A standalone transparent asset with the fixture and a soft downward glow
cone. Positioned via the `.lit-frame` wrapper, which stacks it directly above
a `.framed-poster` with a small negative margin so the light visually
"touches" the frame top edge.

### `wall-panel.svg` — the wood paneled wall
Used as a repeating `background-image` on `.wood-wall` / `.hero-room`. Built
from layered gradients and hand-placed grain strokes (not a filter effect,
since the SVG rendering pipeline used to validate these assets — `cairosvg`
— doesn't reliably support `feTurbulence`/`feComposite` filter chains, so
filters were avoided entirely for safety across renderers).

### `wall-sconce.svg`, `standing-lamp.svg`, `armchair.svg` — room props
Decorative, non-interactive. Placed via the `.hero-room__left` /
`.hero-room__right` regions in `wall.css`. Feel free to delete or resize
these if you want a more minimal hero — the layout degrades gracefully
without them (the grid columns they sit in just go empty).

---

## Customizing colors

All theme colors live as CSS custom properties at the top of `css/base.css`
under `:root`. Change `--color-brass`, `--color-burgundy`, etc. and the whole
app re-themes consistently, including the gradient overlays on cards.

---

## Pages and navigation

- `index.html` — Lobby/Home, matches your reference image
- `movies.html` — full Movies grid
- `series.html` — full Series grid
- `detail.html?id=<id>&type=movie|series` — detail page, reads the URL to
  decide which title to show

All navigation between pages is plain `<a href>` links and works without a
server — you can open `index.html` directly from disk.

---

## Known limitations / things to double check on your machine

- Fonts (Playfair Display, Inter) load from Google Fonts via `<link>` tags.
  If you're offline or have a restricted network, they'll fall back to
  Georgia/system-sans automatically — the layout doesn't break, just the
  exact typeface changes slightly.
- `backdrop-filter` (used for the frosted topbar) needs a reasonably modern
  browser (any current Chrome/Edge/Firefox/Safari works).
