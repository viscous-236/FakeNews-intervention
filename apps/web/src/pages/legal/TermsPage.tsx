import React from 'react';
import { copy } from '../../copy';
import { LegalShell } from './LegalShell';

export function TermsPage(): React.ReactElement {
  return (
    <LegalShell
      title={copy.legal.terms}
      intro="By using this platform you accept transparent reputation accounting, human fact-checking of your posts, and the rules below."
    >
      <section>
        <h2>Accounts</h2>
        <ul>
          <li>You must verify your email before you can post, comment, like or share.</li>
          <li>One person, one account. Accounts created to evade a penalty may be suspended.</li>
          <li>
            You are responsible for what is posted from your account and for keeping your password
            private.
          </li>
        </ul>
      </section>

      <section>
        <h2>Reputation</h2>
        <p>
          Your public interactions create reputation events that are counted when a wave is
          finalized, as described in the{' '}
          <a href="/legal/guidelines" className="text-accent hover:underline">
            guidelines
          </a>
          . Scores are computed only from your own events and your fixed sensitivity. Ledger rows,
          once written, are never changed; corrections are recorded as new events.
        </p>
      </section>

      <section>
        <h2>Fact-checking</h2>
        <p>
          Automated checks only prioritize review. Labels and penalties come from administrators,
          who must record a rationale and may not assess posts they authored, shared, liked or
          reported. Every administrator action is written to an append-only audit log.
        </p>
      </section>

      <section>
        <h2>Appeals</h2>
        <p>
          You may appeal any negative event within the appeal window. Opening an appeal holds the
          event out of the current wave until a different administrator resolves it.
        </p>
      </section>

      <section>
        <h2>Suspension and deletion</h2>
        <p>
          Administrators may suspend accounts for repeated verified misinformation, coordinated
          manipulation or harassment. Suspended members can still sign in to read, view their score
          and follow their appeals. You may delete your account at any time from Settings.
        </p>
      </section>

      <section>
        <h2>Service</h2>
        <p>
          The service is provided as is for an academic project. We may change these terms; the date
          at the top tells you when.
        </p>
      </section>
    </LegalShell>
  );
}
