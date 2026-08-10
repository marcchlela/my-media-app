# Electric Lounge 3D Asset Kit

Generated for the Electric Lounge app theme with the built-in image-generation workflow.

## Art direction

Luxury private cinema with dark walnut wall panels, aged brass, oxblood leather,
warm tungsten lighting, and restrained Art Deco detailing. Assets contain no text,
logos, or trademarks.

## Runtime assets

- `walnut-wall-v2-web.webp`: dark architectural wall background.
- `brass-frame-v2-web.webp`: transparent 9-slice poster frame.
- `picture-light-v2-web.webp`: transparent gallery light fixture.
- `wall-sconce-v2-web.webp`: transparent Art Deco wall sconce.
- `armchair-v2-web.webp`: transparent oxblood cinema chair.
- `side-table-v2-web.webp`: transparent walnut and brass side table.
- `ticket-paper-v2-web.webp`: blank textured cinema-ticket surface.

The larger PNG files are design masters. Chroma-key generation sources are kept in
`sources/`. Both are excluded from packaged desktop builds; only the optimized WebP
files are shipped.

## Prompt set

All assets used photorealistic premium 3D rendering with the shared palette above.
Transparent props were generated on a uniform `#00ff00` background with no cast
shadow, floor, scene, text, logo, or watermark, then converted to alpha PNG and WebP.
The wall was requested as a straight-on, horizontally repeatable architectural
surface. The frame was requested as a symmetrical orthographic square with straight
repeatable rails and a large empty center suitable for 9-slice stretching. The ticket
was requested as blank heavy cotton paper with a quiet center for live HTML content.
