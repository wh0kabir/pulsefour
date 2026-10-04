/**
 * Map icons, drawn on a canvas at runtime (CLAUDE.md sections 7.5, 13, 14).
 *
 * Why generate them rather than use a text layer: MapLibre's `text-field`
 * needs font glyph PBFs, which means a network fetch. The demo has to work
 * with no network, so the severity letters are baked into the sprites here.
 *
 * Section 7.5 is explicit that colour alone is never enough. So:
 *
 *   casualty   circle + severity letter (R / Y / G / B)
 *   ambulance  chevron, pointed along its bearing
 *   hospital   rounded square with a cross, ring coloured by load
 *
 * Three different silhouettes, so the element TYPE is readable at a glance and
 * the colour only carries severity or load.
 */

export const ICON_PIXEL_RATIO = 2;

export interface SpriteImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function canvasOf(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const px = size * ICON_PIXEL_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  ctx.scale(ICON_PIXEL_RATIO, ICON_PIXEL_RATIO);
  return { canvas, ctx };
}

function toSprite(canvas: HTMLCanvasElement): SpriteImage {
  const ctx = canvas.getContext('2d')!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: image.data };
}

/** Casualty: filled circle with the START letter, on a dark rim. */
export function casualtyIcon(colour: string, letter: string, selected = false): SpriteImage {
  const size = 22;
  const { canvas, ctx } = canvasOf(size);
  const c = size / 2;

  if (selected) {
    ctx.beginPath();
    ctx.arc(c, c, 10, 0, Math.PI * 2);
    ctx.strokeStyle = '#E6F6FF';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(c, c, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = '#090A0C';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Black markers use light text; the others are dark-on-bright.
  ctx.fillStyle = letter === 'B' ? '#E8F2FA' : '#090A0C';
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, c, c + 0.5);

  return toSprite(canvas);
}

/**
 * Ambulance: a chevron. Drawn pointing UP so `icon-rotate` can aim it along
 * the bearing. ALS carries a second stroke so the two kinds differ by shape,
 * not only by colour.
 */
export function ambulanceIcon(options: {
  busy: boolean;
  als: boolean;
  selected?: boolean;
}): SpriteImage {
  const size = 24;
  const { canvas, ctx } = canvasOf(size);
  const c = size / 2;

  if (options.selected) {
    ctx.beginPath();
    ctx.arc(c, c, 10.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#E6F6FF';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const fill = options.busy ? '#E6F6FF' : '#6B7480';

  ctx.beginPath();
  ctx.moveTo(c, c - 7);        // nose
  ctx.lineTo(c + 5.5, c + 6);  // right tail
  ctx.lineTo(c, c + 3);        // notch
  ctx.lineTo(c - 5.5, c + 6);  // left tail
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#090A0C';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (options.als) {
    // Advanced life support: an outer chevron outline.
    ctx.beginPath();
    ctx.moveTo(c, c - 10);
    ctx.lineTo(c + 8, c + 7.5);
    ctx.lineTo(c, c + 4.5);
    ctx.lineTo(c - 8, c + 7.5);
    ctx.closePath();
    ctx.strokeStyle = '#2B7BFF';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  return toSprite(canvas);
}

/** Hospital: rounded square with a cross. Ring colour carries the load. */
export function hospitalIcon(options: {
  ring: string;
  trauma: boolean;
  selected?: boolean;
}): SpriteImage {
  const size = 26;
  const { canvas, ctx } = canvasOf(size);
  const c = size / 2;
  const half = 7.5;

  if (options.selected) {
    ctx.beginPath();
    ctx.arc(c, c, 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#E6F6FF';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Body.
  const r = 3;
  ctx.beginPath();
  ctx.moveTo(c - half + r, c - half);
  ctx.arcTo(c + half, c - half, c + half, c + half, r);
  ctx.arcTo(c + half, c + half, c - half, c + half, r);
  ctx.arcTo(c - half, c + half, c - half, c - half, r);
  ctx.arcTo(c - half, c - half, c + half, c - half, r);
  ctx.closePath();
  ctx.fillStyle = '#111317';
  ctx.fill();
  // Trauma-capable hospitals carry a heavier ring, so capability is not
  // signalled by colour alone either.
  ctx.strokeStyle = options.ring;
  ctx.lineWidth = options.trauma ? 2.4 : 1.2;
  ctx.stroke();

  // Cross.
  ctx.fillStyle = options.ring;
  ctx.fillRect(c - 1.1, c - 4.2, 2.2, 8.4);
  ctx.fillRect(c - 4.2, c - 1.1, 8.4, 2.2);

  return toSprite(canvas);
}

/** Every sprite the map needs, keyed by the id used in `icon-image`. */
export function buildAllIcons(): Record<string, SpriteImage> {
  const severities: [string, string, string][] = [
    ['red', '#FF5468', 'R'],
    ['yellow', '#FFC247', 'Y'],
    ['green', '#4ADE9A', 'G'],
    ['black', '#6B7480', 'B'],
  ];

  const icons: Record<string, SpriteImage> = {};

  for (const [key, colour, letter] of severities) {
    icons[`casualty-${key}`] = casualtyIcon(colour, letter, false);
    icons[`casualty-${key}-selected`] = casualtyIcon(colour, letter, true);
  }

  for (const busy of [true, false]) {
    for (const als of [true, false]) {
      const key = `ambulance-${busy ? 'busy' : 'idle'}-${als ? 'als' : 'bls'}`;
      icons[key] = ambulanceIcon({ busy, als });
      icons[`${key}-selected`] = ambulanceIcon({ busy, als, selected: true });
    }
  }

  const rings: [string, string][] = [
    ['healthy', '#4DA8FF'],
    ['busy', '#FF8A3D'],
    ['full', '#FF5468'],
  ];
  for (const [key, ring] of rings) {
    for (const trauma of [true, false]) {
      const id = `hospital-${key}-${trauma ? 'trauma' : 'plain'}`;
      icons[id] = hospitalIcon({ ring, trauma });
      icons[`${id}-selected`] = hospitalIcon({ ring, trauma, selected: true });
    }
  }

  return icons;
}
