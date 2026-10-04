import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

import { useStore } from '../state/store';

/**
 * A guided tour of the console, anchored to the real elements.
 *
 * It points at what to click rather than describing the project in the
 * abstract, so someone meeting this cold can actually drive it. Shows once per
 * browser, then lives behind the "Guide" button.
 */

const STORAGE_KEY = 'pulse.tour.seen';

interface Step {
  /** `data-tour` value of the element to spotlight, or null for a centred card. */
  target: string | null;
  title: string;
  body: string;
  /** Run when the step is shown. */
  action?: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;

export default function Tour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const play = useStore((s) => s.play);
  const pause = useStore((s) => s.pause);
  const setTab = useStore((s) => s.setTab);
  const setAutoAccept = useStore((s) => s.setAutoAccept);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const steps: Step[] = [
    {
      target: null,
      title: 'Pulse in one minute',
      body:
        'A mass-casualty event at Parel. Fourteen ambulances, deliberately too few, and ten ' +
        'hospitals across South Mumbai. Pulse decides who goes where and re-decides every ' +
        'simulated minute. The streets and hospital locations are real, from OpenStreetMap; ' +
        'the casualties, ambulances and bed counts are simulated.',
    },
    {
      target: 'transport',
      title: 'Start here',
      body:
        'Play, and speed up to 4x. One second of real time is one simulated minute. The ' +
        'clock shows how far into the incident you are. Reset starts the same scenario from ' +
        'the same seed, so every run is identical.',
      action: () => play(),
    },
    {
      target: 'health',
      title: 'The situation at a glance',
      body:
        'How many casualties are still waiting, how much of the fleet is committed, how full ' +
        'the hospitals are, and the running average time to reach a casualty.',
    },
    {
      target: 'map',
      title: 'Read the map',
      body:
        'Circles with letters are casualties, lettered R, Y, G and B for the START triage ' +
        'colours. Chevrons are ambulances, pointing where they are driving. Crosses are ' +
        'hospitals, ringed red when full. Dashed red is a closed road. Click anything to ' +
        'inspect it, press Escape to clear, and open the Legend bottom-right.',
    },
    {
      target: 'decisions',
      title: 'Every decision explains itself',
      body:
        'Click any card. You get travel time to the scene, travel on to hospital, the ' +
        'hospital load penalty, the severity weight, and which hospitals were rejected and ' +
        'why. Every number shown is one the allocator actually used to decide.',
    },
    {
      target: 'operator',
      title: 'Take control',
      body:
        'This is the human side. Press "Take control" and nothing moves until you approve ' +
        'it: confirm, override to a different hospital, or reject. Escalations are cases ' +
        'the system cannot serve and hands to you rather than dropping silently.',
      action: () => {
        pause();
        setAutoAccept(false);
      },
    },
    {
      target: 'scenario',
      title: 'Break things on purpose',
      body:
        'These inject world events: fill a hospital, surge more casualties, take an ' +
        'ambulance offline, raise congestion. In a real deployment they would arrive from ' +
        'traffic data and hospital systems. Watch the plan re-form within a minute.',
    },
    {
      target: 'tabs',
      title: 'Compare, and check the record',
      body:
        'Compare runs all three strategies on the same seed and reports where Pulse loses as ' +
        'well as where it wins. Ledger holds the hash-chained log: pin a checkpoint, then use ' +
        'Demo tools to tamper with it and verify. That is the whole demo.',
      action: () => {
        setAutoAccept(true);
        setTab('map');
      },
    },
  ];

  const current = steps[step];
  const targetKey = current?.target ?? null;

  const measure = useCallback(() => {
    if (!targetKey) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${targetKey}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [targetKey]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, measure]);

  function close(): void {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Private window: it will simply show again next time.
    }
    setOpen(false);
    setStep(0);
  }

  function go(next: number): void {
    if (next >= steps.length) {
      close();
      return;
    }
    steps[next]?.action?.();
    setStep(next);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowRight') go(step + 1);
      if (event.key === 'ArrowLeft' && step > 0) setStep(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
        className="rounded-md px-3 py-1 text-xs text-mist transition-colors hover:text-frost"
      >
        Guide
      </button>
    );
  }

  if (!current) return null;

  // Place the card beside the spotlight, flipping to whichever side has room.
  const CARD_W = 340;
  let cardStyle: React.CSSProperties = {};
  if (rect) {
    const spaceRight = window.innerWidth - (rect.left + rect.width);
    const left =
      spaceRight > CARD_W + 32
        ? rect.left + rect.width + 16
        : rect.left > CARD_W + 32
          ? rect.left - CARD_W - 16
          : Math.max(16, Math.min(rect.left, window.innerWidth - CARD_W - 16));
    const top = Math.max(16, Math.min(rect.top, window.innerHeight - 280));
    cardStyle = { top, left, width: CARD_W };
  }

  return (
    <>
      {/* Dim everything except the spotlight, using a ring rather than a
          cut-out so the highlighted element stays fully interactive-looking. */}
      <div className="pointer-events-none fixed inset-0 z-40 bg-matte/75" />

      {rect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-40 rounded-lg"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(9,10,12,0.75), 0 0 0 2px #4DA8FF',
          }}
        />
      )}

      <button
        type="button"
        onClick={close}
        aria-label="Close the guide"
        className="fixed inset-0 z-40 cursor-default"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className={
          'fixed z-50 rounded-xl border border-hairline bg-slate p-5 ' +
          (rect ? '' : 'top-1/2 left-1/2 w-[min(32rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2')
        }
        style={rect ? cardStyle : undefined}
      >
        <p className="text-[11px] text-ice-300">
          Step {step + 1} of {steps.length}
        </p>
        <h2 id="tour-title" className="mt-1.5 font-display text-base font-medium text-frost">
          {current.title}
        </h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-mist">{current.body}</p>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(step + 1)}
            className="rounded-md bg-ice-600 px-3.5 py-1.5 text-xs font-medium text-matte hover:bg-ice-500"
          >
            {step >= steps.length - 1 ? 'Start exploring' : 'Next'}
          </button>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="rounded-md border border-hairline px-3 py-1.5 text-xs text-mist hover:text-frost"
            >
              Back
            </button>
          )}
          <button type="button" onClick={close} className="ml-auto text-xs text-mist hover:text-frost">
            Skip
          </button>
        </div>

        <div className="mt-3.5 flex gap-1" aria-hidden="true">
          {steps.map((s, i) => (
            <span
              key={s.title}
              className={'h-0.5 flex-1 rounded-full ' + (i <= step ? 'bg-ice-500' : 'bg-graphite')}
            />
          ))}
        </div>
      </div>
    </>
  );
}
