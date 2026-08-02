
export const WATERMARK_TEXT = 'REVIVA PREVIEW';

const WIDTH = 640;
const HEIGHT = 640;
const TILE_X = 260;
const TILE_Y = 110;

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tiledMarks(): string {
  const marks: string[] = [];
  for (let y = 50; y < HEIGHT + TILE_Y; y += TILE_Y) {
    for (let x = -TILE_X; x < WIDTH + TILE_X; x += TILE_X) {
      marks.push(
        `<text x="${x}" y="${y}" transform="rotate(-30 ${x} ${y})" font-family="sans-serif" ` +
          `font-size="24" font-weight="700" fill="rgba(255,255,255,0.5)" ` +
          `stroke="rgba(0,0,0,0.35)" stroke-width="0.5">${WATERMARK_TEXT}</text>`
      );
    }
  }
  return marks.join('');
}

export function watermarkPreview(image: string): string {
  const source = typeof image === 'string' ? image : '';
  const backdrop = source
    ? `<image href="${escapeXmlAttr(source)}" xlink:href="${escapeXmlAttr(source)}" x="0" y="0" ` +
      `width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#1a1a1a"/>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    backdrop +
    `<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="rgba(0,0,0,0.1)"/>` +
    tiledMarks() +
    `</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
