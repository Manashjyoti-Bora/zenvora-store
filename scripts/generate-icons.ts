import sharp from 'sharp';

async function generateIcons() {
  const size192 = 192;
  const size512 = 512;
  
  // Create a base SVG with a simple "Z" logo for Zenvora
  const svg = (size: number) => `
    <svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" fill="#174B3A"/>
      <text x="256" y="340" font-family="sans-serif" font-size="280" font-weight="bold" fill="#C6A66B" text-anchor="middle">Z</text>
    </svg>
  `;

  await sharp(Buffer.from(svg(size192)))
    .png()
    .toFile('./public/icon-192x192.png');

  await sharp(Buffer.from(svg(size512)))
    .png()
    .toFile('./public/icon-512x512.png');
}

generateIcons().catch(console.error);