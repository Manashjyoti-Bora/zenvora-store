/**
 * Generate static brand assets that must exist as raster files:
 *
 *  1. `public/og-default.png` (1200x630) — default Open Graph / Twitter card
 *     image referenced by the root layout metadata. Product pages override it
 *     with the real product photo; every other public page inherits it so
 *     shared links never render a blank card.
 *  2. `src/app/apple-icon.png` (180x180) — Apple touch icon, served
 *     automatically by the Next.js `apple-icon.png` file convention.
 *
 * The artwork is deliberately WORDLESS (brand colours + shopping-bag mark):
 * the store name is dynamic (Admin → Settings / APP_NAME), so baking a
 * wordmark into pixels would go stale on rename. OG titles/descriptions stay
 * dynamic text via metadata — only the abstract brand tile is baked here.
 *
 * Regenerate after changing brand colours or `src/app/icon.svg`:
 *   npm run og:image
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Forest green → deep green card with a champagne bag mark and quiet geometry.
const OG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#10392D"/>
      <stop offset="1" stop-color="#174B3A"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1050" cy="80" r="220" fill="none" stroke="#C6A66B" stroke-opacity="0.16" stroke-width="2"/>
  <circle cx="1050" cy="80" r="150" fill="none" stroke="#C6A66B" stroke-opacity="0.12" stroke-width="2"/>
  <circle cx="120" cy="560" r="180" fill="none" stroke="#C6A66B" stroke-opacity="0.10" stroke-width="2"/>
  <rect x="470" y="155" width="260" height="260" rx="56" fill="none" stroke="#C6A66B" stroke-width="6"/>
  <g transform="translate(472, 173) scale(4)">
    <g fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 22h28l-3.5 22a4 4 0 0 1-4 3.3H25.5a4 4 0 0 1-4-3.3L18 22z"/>
      <path d="M24 22v-2a8 8 0 0 1 16 0v2"/>
    </g>
    <circle cx="27" cy="32" r="2.6" fill="#C6A66B"/>
    <circle cx="37" cy="32" r="2.6" fill="#C6A66B"/>
  </g>
  <rect x="548" y="470" width="104" height="6" rx="3" fill="#C6A66B" fill-opacity="0.85"/>
</svg>`;

const ogOut = path.join(root, 'public', 'og-default.png');
await sharp(Buffer.from(OG_SVG)).png({ compressionLevel: 9 }).toFile(ogOut);
console.log(`wrote ${path.relative(root, ogOut)}`);

// Apple touch icon: the SVG favicon rasterised at 180x180 on a solid brand
// background (iOS renders transparency as black, so flatten explicitly).
const faviconSvg = readFileSync(path.join(root, 'src', 'app', 'icon.svg'));
const appleOut = path.join(root, 'src', 'app', 'apple-icon.png');
await sharp(faviconSvg)
  .resize(180, 180, { fit: 'fill' })
  .flatten({ background: '#174B3A' })
  .png({ compressionLevel: 9 })
  .toFile(appleOut);
console.log(`wrote ${path.relative(root, appleOut)}`);
