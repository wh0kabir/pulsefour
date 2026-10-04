import { useEffect, useRef, useState } from 'react';

import { ambulanceIcon, casualtyIcon, hospitalIcon, type SpriteImage } from './icons';

/**
 * Map legend (CLAUDE.md section 7.5).
 *
 * Severity is never carried by colour alone, so the legend shows the actual
 * sprites — shape and letter included — rather than coloured swatches.
 */

function Swatch({ sprite, label }: { sprite: SpriteImage; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = sprite.width;
    canvas.height = sprite.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Built through createImageData rather than `new ImageData(...)`: the
    // constructor's typed-array overload is fussy across TS lib versions.
    const image = ctx.createImageData(sprite.width, sprite.height);
    image.data.set(sprite.data);
    ctx.putImageData(image, 0, 0);
  }, [sprite]);

  return (
    <li className="flex items-center gap-1.5">
      <canvas
        ref={ref}
        aria-hidden="true"
        className="h-4 w-4 shrink-0"
        style={{ imageRendering: 'auto' }}
      />
      <span className="text-[10px] leading-tight text-mist">{label}</span>
    </li>
  );
}

export default function Legend() {
  const [open, setOpen] = useState(false);

  // Built once; drawing to a canvas is cheap but pointless to repeat.
  const sprites = useRef<{
    casualties: [SpriteImage, string][];
    ambulances: [SpriteImage, string][];
    hospitals: [SpriteImage, string][];
  } | null>(null);

  if (!sprites.current) {
    sprites.current = {
      casualties: [
        [casualtyIcon('#FF5468', 'R'), 'Red — immediate'],
        [casualtyIcon('#FFC247', 'Y'), 'Yellow — delayed'],
        [casualtyIcon('#4ADE9A', 'G'), 'Green — minor'],
        [casualtyIcon('#6B7480', 'B'), 'Black — not dispatched'],
      ],
      ambulances: [
        [ambulanceIcon({ busy: true, als: true }), 'ALS, on a job'],
        [ambulanceIcon({ busy: true, als: false }), 'BLS, on a job'],
        [ambulanceIcon({ busy: false, als: false }), 'Idle'],
      ],
      hospitals: [
        [hospitalIcon({ ring: '#4DA8FF', trauma: true }), 'Trauma-capable'],
        [hospitalIcon({ ring: '#4DA8FF', trauma: false }), 'Not trauma-capable'],
        [hospitalIcon({ ring: '#FF8A3D', trauma: true }), '80% full or more'],
        [hospitalIcon({ ring: '#FF5468', trauma: true }), 'No beds free'],
      ],
    };
  }

  const { casualties, ambulances, hospitals } = sprites.current;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-3 bottom-3 rounded-md border border-hairline bg-slate/90 px-2.5 py-1 text-[11px] text-mist transition-colors hover:text-frost"
      >
        Legend
      </button>
    );
  }

  return (
    <div className="absolute right-3 bottom-3 w-52 rounded-lg border border-hairline bg-slate/95 p-3">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-medium text-frost">Legend</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="-mt-0.5 text-mist hover:text-frost"
          aria-label="Hide legend"
        >
          &times;
        </button>
      </div>

      <p className="mt-2 text-[10px] font-medium text-ice-300">Casualties</p>
      <ul className="mt-1 space-y-0.5">
        {casualties.map(([sprite, label]) => (
          <Swatch key={label} sprite={sprite} label={label} />
        ))}
      </ul>

      <p className="mt-2.5 text-[10px] font-medium text-ice-300">Ambulances</p>
      <ul className="mt-1 space-y-0.5">
        {ambulances.map(([sprite, label]) => (
          <Swatch key={label} sprite={sprite} label={label} />
        ))}
      </ul>

      <p className="mt-2.5 text-[10px] font-medium text-ice-300">Hospitals</p>
      <ul className="mt-1 space-y-0.5">
        {hospitals.map(([sprite, label]) => (
          <Swatch key={label} sprite={sprite} label={label} />
        ))}
      </ul>

      <p className="mt-2.5 border-t border-hairline pt-2 text-[10px] leading-relaxed text-mist">
        Dashed red is a closed road. Ice-blue lines are ambulances already en route.
      </p>
    </div>
  );
}
