import React from 'react';
import { copy } from '../../copy';
import { LegalShell } from './LegalShell';

export function PrivacyPage(): React.ReactElement {
  return (
    <LegalShell
      title={copy.legal.privacy}
      intro="We keep the minimum needed to run the platform and to keep the credibility ledger honest. This page lists what that is."
    >
      <section>
        <h2>What we store</h2>
        <ul>
          <li>Your email, username, display name and bio.</li>
          <li>A hash of your password (argon2id). We never store the password itself.</li>
          <li>
            Your posts, comments, likes, shares, follows, blocks, reports, appeals and direct
            messages.
          </li>
          <li>
            Your reputation events and the per-wave ledger rows that record how your score changed.
          </li>
          <li>
            Sessions: a hashed token, the device’s user agent and IP address, and when it was last
            seen.
          </li>
        </ul>
      </section>

      <section>
        <h2>Images</h2>
        <p>
          Uploaded images are decoded, stripped of metadata such as location, resized to at most
          4096 pixels on the longest side and re-encoded as WebP. The original file is never stored.
        </p>
      </section>

      <section>
        <h2>Automated checks</h2>
        <p>
          The text of each post is sent to our own detection service, which returns a probability
          used only to prioritize human review. The service keeps no copy of your text and has no
          access to the internet.
        </p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          One session cookie, marked HttpOnly, SameSite=Lax and Secure in production. No advertising
          or analytics trackers.
        </p>
      </section>

      <section>
        <h2>Your data, your rights</h2>
        <ul>
          <li>Export: download everything above as JSON from Settings.</li>
          <li>
            Delete: deleting your account removes your email, name, bio, photo and password hash,
            signs you out everywhere and renames the account to an anonymous id. Posts, events and
            ledger rows are kept under that anonymous id so other members’ scores stay reproducible.
          </li>
        </ul>
      </section>
    </LegalShell>
  );
}
