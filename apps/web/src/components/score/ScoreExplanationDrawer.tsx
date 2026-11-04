import React from 'react';
import type { EventItem } from '../../types';
import { copy } from '../../copy';
import { signed, signedDecimal } from '../../lib/format';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

export interface ScoreExplanationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  waveNumber: number;
  qBefore: string;
  sigma: string;
  nPos: number;
  nNeg: number;
  nAdj: number;
  r: number;
  delta: string;
  qAfter: string;
  countedEvents?: EventItem[];
}

/**
 * Per-wave explanation (TASK-090): the formula with the user's numbers
 * substituted. All values arrive from the API; nothing is computed here.
 */
export function ScoreExplanationDrawer({
  isOpen,
  onClose,
  waveNumber,
  qBefore,
  sigma,
  nPos,
  nNeg,
  nAdj,
  r,
  delta,
  qAfter,
  countedEvents = [],
}: ScoreExplanationDrawerProps): React.ReactElement | null {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={copy.score.drawerTitle(waveNumber)} size="lg">
      <div className="space-y-6">
        <div className="rounded-card bg-raised p-4">
          <p className="font-mono text-section text-ink">{copy.score.formula}</p>
          <p className="mt-1 font-mono text-body text-muted">{copy.score.formulaR}</p>
        </div>

        <section aria-labelledby="substitution-title">
          <h3 id="substitution-title" className="text-section text-ink">
            {copy.score.substitution}
          </h3>
          <dl className="mt-2 divide-y divide-rule font-mono text-body">
            <Row label={copy.score.nPos} value={signed(nPos)} tone="positive" />
            <Row label={copy.score.nNeg} value={`-${nNeg}`} tone="negative" />
            <Row label={copy.score.nAdj} value={signed(nAdj)} />
            <Row label={copy.score.columns.r} value={signed(r)} strong />
            <Row label={copy.score.projectedDelta} value={`${sigma} × ${r} = ${delta}`} strong />
            <Row
              label={copy.score.columns.qAfter}
              value={`${qBefore} + (${delta}) = ${qAfter}`}
              strong
            />
          </dl>
        </section>

        {countedEvents.length > 0 ? (
          <section aria-labelledby="counted-title">
            <h3 id="counted-title" className="text-section text-ink">
              {copy.score.countedEvents(countedEvents.length)}
            </h3>
            <ul className="mt-2 divide-y divide-rule">
              {countedEvents.map((ev) => (
                <li key={ev.id} className="flex items-start gap-3 py-2.5 text-body">
                  <span
                    className={`num w-8 shrink-0 font-mono ${ev.value > 0 ? 'text-positive' : 'text-negative'}`}
                  >
                    {signed(ev.value)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-ink">{copy.eventKind[ev.kind]}</p>
                    <p className="line-clamp-1 text-small text-muted">“{ev.post.excerpt}”</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="text-small text-muted">
          Δ = {signedDecimal(delta)} · {copy.score.formulaNotice}
        </p>

        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            {copy.common.close}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({
  label,
  value,
  tone,
  strong = false,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
  strong?: boolean;
}): React.ReactElement {
  const color =
    tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-ink';
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="font-sans text-muted">{label}</dt>
      <dd className={`num text-right ${color} ${strong ? 'font-medium' : ''}`}>{value}</dd>
    </div>
  );
}
