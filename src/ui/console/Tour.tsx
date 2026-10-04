import { useEffect, useState } from 'react';

import { useStore } from '../state/store';

/**
 * A short guided tour for first-time viewers.
 *
 * Shows once per browser, then lives behind the "Guide" button. Deliberately
 * plain: it explains what to look at and what is real, and never oversells.
 */

const STORAGE_KEY = 'pulse.tour.seen';

interface Step {
  title: string;
  body: string;
  /** Optional action run when the step is shown. */
  action?: () => void;
}

export default function Tour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const play = useStore((s) => s.play);
  const setTab = useStore((s) => s.setTab);
  const world = useStore((s) => s.world);

  useEffect(() => {
    // localStorage can throw in a private window; never let that break the page.
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const steps: Step[] = [
    {
      title: 'Pulse in one minute',
      body:
        'A mass-casualty event at Parel. Fourteen ambulances, deliberately too few, and ten ' +
        'hospitals across South Mumbai. Pulse decides who goes where, re-deciding every ' +
        'simulated minute as the situation changes.',
    },
    {
      title: 'What is real here',
      body:
        'The streets and hospital locations are real, extracted from OpenStreetMap — 7,013 ' +
        'road segments. Routing runs on that real network, so closing a road genuinely ' +
        'changes travel times. Casualties, ambulances and bed counts are simulated, and ' +
        'anything simulated is badged as such.',
    },
    {
      title: 'Press play and watch the map',
      body:
        'Casualties appear in waves at the top of the map, lettered R, Y, G and B for the ' +
        'START triage colours. Chevrons are ambulances; crosses are hospitals, ringed red ' +
        'when full. Around minute 12 a main road closes and the plan re-forms.',
      action: () => play(),
    },
    {
      title: 'Every decision explains itself',
      body:
        'Open any card in the Decisions feed on the right. You get the travel times, the ' +
        'hospital load penalty, the severity weight, and which alternatives were rejected ' +
        'and why. Every number shown is one the allocator actually used.',
    },
    {
      title: 'You can take over',
      body:
        'The Operator panel on the left runs the human side. Press "Take control" to turn ' +
        'off auto-accept: nothing then moves until you confirm, override or reject each ' +
        'assignment. The Scenario panel above it injects world events instead.',
    },
    {
      title: 'Check the record, and the scoreboard',
      body:
        'The Ledger tab holds a hash-chained log. Pin a checkpoint, then use Demo tools to ' +
        'tamper with it and verify — it names the first row that no longer adds up. The ' +
        'Compare tab runs all three strategies on the same seed and reports where Pulse ' +
        'loses as well as where it wins.',
      action: () => setTab('map'),
    },
  ];

  const current = steps[step];

  function close(): void {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Private window: it will simply show again next time.
    }
    setOpen(false);
    setStep(0);
  }

  function next(): void {
    if (step >= steps.length - 1) {
      close();
      return;
    }
    const upcoming = steps[step + 1];
    upcoming?.action?.();
    setStep(step + 1);
  }

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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Hide the guide"
        className="fixed inset-0 z-40 cursor-default bg-matte/70"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="fixed top-1/2 left-1/2 z-50 w-[min(30rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-slate p-6"
      >
        <p className="text-[11px] text-ice-300">
          Step {step + 1} of {steps.length}
        </p>
        <h2 id="tour-title" className="mt-1.5 font-display text-lg font-medium text-frost">
          {current.title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-mist">{current.body}</p>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={next}
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
          <button
            type="button"
            onClick={close}
            className="ml-auto text-xs text-mist hover:text-frost"
          >
            Skip
          </button>
        </div>

        <div className="mt-4 flex gap-1" aria-hidden="true">
          {steps.map((s, i) => (
            <span
              key={s.title}
              className={
                'h-0.5 flex-1 rounded-full ' + (i <= step ? 'bg-ice-500' : 'bg-graphite')
              }
            />
          ))}
        </div>

        {!world && (
          <p className="mt-3 text-[10px] text-mist">Loading the road network…</p>
        )}
      </div>
    </>
  );
}
