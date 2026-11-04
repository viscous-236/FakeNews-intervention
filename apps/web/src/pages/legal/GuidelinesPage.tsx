import React from 'react';
import { copy } from '../../copy';
import { BookOpen, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

export const GuidelinesPage: React.FC = () => {
  return (
    <article className="max-w-3xl mx-auto bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-8 shadow-sm space-y-6 text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
      <div className="border-b border-neutral-200 dark:border-neutral-700 pb-4">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <span>{copy.legal.guidelinesTitle}</span>
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          {copy.legal.guidelinesDescription}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          1. Mathematical Score Updates (Equation 2)
        </h2>
        <p>
          Credibility reputation is quantified by score $Q$. Scores do not change instantaneously on every like or post; rather, interactions are accumulated into periodic <strong>reputation waves</strong>. Upon finalization of wave $w$, score updates according to:
        </p>
        <div className="bg-neutral-900 text-neutral-100 rounded-xl p-4 font-mono text-center text-sm font-bold">
          Q(w + 1) = Q(w) + σ × R(w)
        </div>
        <p className="text-xs text-neutral-500">
          Where R(w) = n⁺(w) - n⁻(w) + adjustments, and σ represents your fixed personal responsiveness parameter (0 &lt; σ ≤ 1).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          2. The Seven Reputation Event Kinds (v2.0 Specification)
        </h2>
        <div className="space-y-2 text-xs">
          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong>RESPONSIBLE_POST (+1):</strong> Awarded when a post you authored is reviewed and verified as true by independent fact-checkers.
            </div>
          </div>

          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong>RESPONSIBLE_RESHARE (+1):</strong> Awarded when you share a verified truthful post, amplifying reliable claims across the network.
            </div>
          </div>

          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong>VALID_REPORT (+1):</strong> Awarded when you report a post that fact-checkers subsequently determine to be false or deceptive.
            </div>
          </div>

          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 flex items-start gap-2.5">
            <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong>MISINFO_POST (-1):</strong> Applied when a claim you published is fact-checked and confirmed false.
            </div>
          </div>

          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 flex items-start gap-2.5">
            <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong>MISINFO_RESHARE (-1):</strong> Applied when you amplify and distribute a post verified as false.
            </div>
          </div>

          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 flex items-start gap-2.5">
            <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong>MISINFO_LIKE (-1):</strong> Applied when you endorse or like a post that fact-checkers verify as false.
            </div>
          </div>

          <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-850 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong>REVERSAL (+1 / -1):</strong> Correction event created when an appeal is overturned or an assessment is corrected upon higher review.
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          3. Good-Faith Retractions and Void Reasons
        </h2>
        <p>
          We incentivize honest discourse and timely course corrections. An event may transition to <code className="font-mono text-xs bg-neutral-100 dark:bg-neutral-700 px-1 py-0.5 rounded">voided</code> status for one of three reasons:
        </p>
        <ul className="list-disc list-inside space-y-1.5 text-xs pl-2">
          <li>
            <strong>interaction_retracted:</strong> If you un-like or retract a reshare before the active wave finalizes, the pending penalty is annulled and will never be entered into the ledger.
          </li>
          <li>
            <strong>cap_exceeded:</strong> Safeguard capping maximum positive rewards per user in a single wave (preventing reward farming).
          </li>
          <li>
            <strong>assessment_superseded:</strong> If new evidence causes fact-checkers to update or overturn an earlier verdict.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          4. Comments Immunity (DEC-006)
        </h2>
        <p>
          Comments on posts exist to foster constructive criticism, debate, and context sharing. Comments are strictly exempt from automated and manual reputation scoring events to encourage open inquiry without fear of score penalties.
        </p>
      </section>
    </article>
  );
};
