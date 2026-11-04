import React from 'react';
import { copy } from '../../copy';
import { Scale } from 'lucide-react';

export const TermsPage: React.FC = () => {
  return (
    <article className="max-w-3xl mx-auto bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-8 shadow-sm space-y-6 text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
      <div className="border-b border-neutral-200 dark:border-neutral-700 pb-4">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <Scale className="w-6 h-6 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <span>{copy.legal.termsTitle}</span>
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          {copy.legal.termsDescription}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          1. Algorithmic Credibility Architecture
        </h2>
        <p>
          By creating an account or participating in discussions on this platform, you acknowledge and agree that your public interactions—specifically authored posts, shared posts, likes, and moderation reports—are subject to transparent algorithmic reputation accounting. Scores are calculated deterministically through periodic reputation waves governed by mathematical proofs.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          2. Human-in-the-Loop Fact-Checking
        </h2>
        <p>
          Automated machine learning models (specifically fine-tuned RoBERTa transformer classifiers) screen content for review prioritization only. No automated score penalties or public fact-check labels are ever applied without independent human verification.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          3. Prohibited Conduct and Misinformation
        </h2>
        <p>
          Users may not deliberately disseminate fabricated claims, impersonate organizations, coordinate synthetic amplification, or weaponize moderation reporting systems. Repeated propagation of debunked claims results in low credibility tier classification and may lead to account suspension.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          4. Right to Appeal
        </h2>
        <p>
          Every contributor retains the statutory right to contest adverse fact-checking assessments within a 14-day window. Lodging an appeal freezes the penalty, preventing it from affecting finalized wave reputation until an independent moderator review concludes.
        </p>
      </section>
    </article>
  );
};
