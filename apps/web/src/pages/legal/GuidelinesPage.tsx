import React from 'react';
import { copy } from '../../copy';
import { LegalShell } from './LegalShell';

export function GuidelinesPage(): React.ReactElement {
  return (
    <LegalShell
      title={copy.legal.guidelines}
      intro="This platform rewards accurate posts and penalizes misinformation with a transparent, wave-based score. Here is exactly how posts, shares, likes, reports, retractions and waves affect that score."
    >
      <section>
        <h2>The score</h2>
        <p>
          Every member has a credibility score Q that starts at 0, and a sensitivity σ between 0 and
          1 that is fixed when the account is created and never changes. Interactions do not move
          the score immediately. They create events that are counted when an administrator finalizes
          the current wave, using the formula from the paper this platform implements:
        </p>
        <p>
          <code>Q(w+1) = Q(w) + σ × R(w)</code>, where{' '}
          <code>R(w) = n⁺(w) − n⁻(w) + adjustments</code>.
        </p>
        <p>
          n⁺ counts positive events and n⁻ counts negative events in the wave. Adjustments are
          reversals created when an earlier verdict is corrected. Nothing else feeds the score: not
          followers, not engagement, not the publisher’s own reputation.
        </p>
      </section>

      <section>
        <h2>Who decides what is true</h2>
        <p>
          An automated check runs on every post and sorts it into a band: likely real, uncertain or
          likely fake. That check only decides what human reviewers look at first. It never creates
          a label that says a post is false and never changes a score. Only a reviewer’s assessment
          does, with a written rationale you can read on the post and in your event history.
        </p>
      </section>

      <section>
        <h2>The seven events</h2>
        <ul>
          <li>
            Authored verified post (+1): a post you wrote was assessed as true, by a reviewer or by
            the automatic low-risk rule.
          </li>
          <li>
            Shared verified post (+1): you shared a post that a reviewer assessed as true. At most 5
            count per wave.
          </li>
          <li>
            Reported false post (+1): you reported a post before a reviewer assessed it as false. At
            most 5 count per wave.
          </li>
          <li>
            Authored false post (−1): a post you wrote was assessed as false. The penalty is the
            same whether 0 or 10,000 people shared it.
          </li>
          <li>Shared false post (−1): you shared a post that was assessed as false.</li>
          <li>Liked false post (−1): you liked a post that was assessed as false.</li>
          <li>
            Reversal (+1 or −1): a correction that cancels an event already counted in a closed wave
            when the verdict changes.
          </li>
        </ul>
        <p>Comments, follows, direct messages and blocks never create events.</p>
      </section>

      <section>
        <h2>Changing your mind</h2>
        <p>
          If you remove a like or retract a share before the wave closes, the pending event is
          voided and never counted. Once a wave has been finalized, the counted event and its ledger
          row are permanent. Sharing again under the same verdict reactivates the voided event
          instead of creating a second one.
        </p>
        <p>
          You are protected when you act in good faith: if you shared or liked a post while a
          reviewer had marked it true, and that verdict is later overturned, you are not penalized
          for that interaction.
        </p>
      </section>

      <section>
        <h2>Labels and tiers</h2>
        <ul>
          <li>“{copy.postLabel.fact_checked_true}”: a reviewer assessed the post as true.</li>
          <li>“{copy.postLabel.fact_checked_false}”: a reviewer assessed the post as false.</li>
          <li>
            “{copy.postLabel.unverifiable}”: a reviewer could not verify the post. No events are
            created.
          </li>
          <li>
            “{copy.postLabel.auto_flagged}”: the automated check flagged the post for review. Not a
            verdict.
          </li>
        </ul>
        <p>
          Your tier is read from your score: trusted at or above the trusted threshold, low at or
          below the low threshold, neutral in between. Sharing a flagged or false post, or a post by
          a low-tier author, asks you to confirm first. Feeds stay strictly chronological; no post
          is ranked up or down by score.
        </p>
      </section>

      <section>
        <h2>Appeals</h2>
        <p>
          Any negative event can be appealed within the appeal window. While the appeal is open, the
          event is held out of the wave. A different administrator resolves it: upheld returns the
          event to the open wave; overturned creates a corrected assessment and, for events already
          counted, a reversal.
        </p>
      </section>

      <section>
        <h2>Conduct</h2>
        <ul>
          <li>
            Do not post fabricated claims or present rumours as fact. Cite a source when you can.
          </li>
          <li>Do not coordinate shares, likes or reports to game the score.</li>
          <li>
            Do not harass other members. Harassment reports go to reviewers like any other report.
          </li>
          <li>Repeated verified misinformation lowers your tier and may lead to suspension.</li>
        </ul>
      </section>
    </LegalShell>
  );
}
