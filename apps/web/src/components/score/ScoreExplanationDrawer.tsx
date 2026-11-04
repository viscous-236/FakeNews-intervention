import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { copy } from '../../copy';
import { EventItem } from '../../types';
import { Calculator, CheckCircle2, XCircle } from 'lucide-react';

interface ScoreExplanationDrawerProps {
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

export const ScoreExplanationDrawer: React.FC<ScoreExplanationDrawerProps> = ({
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
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${copy.score.drawerTitle} (Wave #${waveNumber})`}
      size="lg"
    >
      <div className="space-y-6 text-sm">
        {/* Core Formula Box */}
        <div className="bg-neutral-900 text-neutral-100 dark:bg-black rounded-xl p-4 font-mono text-center space-y-2">
          <p className="text-primary-400 text-xs font-semibold tracking-wider uppercase">
            Paper Equation 2 Specification
          </p>
          <div className="text-base sm:text-lg font-bold">
            {copy.score.formulaDisplay}
          </div>
          <div className="text-xs text-neutral-400">
            {copy.score.formulaRDisplay}
          </div>
        </div>

        {/* Live Arithmetic Substitution */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 bg-neutral-50 dark:bg-neutral-850 space-y-3">
          <h3 className="font-semibold text-xs text-neutral-500 uppercase tracking-wider flex items-center gap-1.5">
            <Calculator className="w-3.5 h-3.5 text-primary-600" aria-hidden="true" />
            <span>Mathematical Substitution</span>
          </h3>

          <div className="space-y-1.5 font-mono text-xs">
            <div className="flex justify-between py-1 border-b border-neutral-200 dark:border-neutral-700">
              <span className="text-neutral-600 dark:text-neutral-400">Positive Actions (n⁺)</span>
              <span className="font-semibold text-green-600 dark:text-green-400">+{nPos}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-neutral-200 dark:border-neutral-700">
              <span className="text-neutral-600 dark:text-neutral-400">Misinformation Penalties (n⁻)</span>
              <span className="font-semibold text-red-600 dark:text-red-400">-{nNeg}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-neutral-200 dark:border-neutral-700">
              <span className="text-neutral-600 dark:text-neutral-400">Adjustments (n_adj)</span>
              <span className="font-semibold text-purple-600 dark:text-purple-400">{nAdj >= 0 ? `+${nAdj}` : nAdj}</span>
            </div>
            <div className="flex justify-between py-1 font-bold border-b border-neutral-300 dark:border-neutral-600">
              <span>Net Reputation Reward R(w)</span>
              <span>{r >= 0 ? `+${r}` : r}</span>
            </div>
            <div className="flex justify-between py-1 text-primary-600 dark:text-primary-400 font-bold">
              <span>Reputation Delta (σ × R)</span>
              <span>
                {sigma} × {r} = {delta}
              </span>
            </div>
            <div className="flex justify-between pt-2 text-sm font-bold border-t border-neutral-300 dark:border-neutral-600">
              <span>Updated Score Q(w + 1)</span>
              <span>
                {qBefore} + ({delta}) = {qAfter}
              </span>
            </div>
          </div>
        </div>

        {/* Counted Events Breakdown */}
        {countedEvents.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-xs text-neutral-700 dark:text-neutral-300 uppercase tracking-wider">
              Counted Events in this Wave ({countedEvents.length})
            </h3>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-700 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden text-xs">
              {countedEvents.map((ev) => {
                const isPos = ev.value > 0;
                return (
                  <div key={ev.id} className="p-3 bg-white dark:bg-neutral-800 flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                        {isPos ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" aria-hidden="true" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" aria-hidden="true" />
                        )}
                        <span>{copy.eventKind[ev.kind] || ev.kind}</span>
                      </div>
                      <p className="text-[11px] text-neutral-500 italic">
                        "{ev.post.excerpt}"
                      </p>
                    </div>
                    <span
                      className={`font-mono font-bold px-2 py-0.5 rounded text-xs shrink-0 ${
                        isPos
                          ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                      }`}
                    >
                      {isPos ? `+${ev.value}` : ev.value}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="primary" onClick={onClose}>
            {copy.close}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
