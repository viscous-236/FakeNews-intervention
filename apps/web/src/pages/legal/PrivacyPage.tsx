import React from 'react';
import { copy } from '../../copy';
import { ShieldCheck } from 'lucide-react';

export const PrivacyPage: React.FC = () => {
  return (
    <article className="max-w-3xl mx-auto bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-8 shadow-sm space-y-6 text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
      <div className="border-b border-neutral-200 dark:border-neutral-700 pb-4">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <span>{copy.legal.privacyTitle}</span>
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          {copy.legal.privacyDescription}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          1. Data Minimization Principles
        </h2>
        <p>
          We strictly practice data minimization. We only collect information essential for platform security and reputation accounting: your email address (used solely for authentication and system alerts), username, display name, and optional biography. Passwords are cryptographically salted and hashed using Argon2id with memory-hard parameters.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          2. Media Sanitization and Processing
        </h2>
        <p>
          Uploaded image attachments are parsed, stripped of EXIF and geolocation metadata, scaled to a maximum resolution of 4096 pixels, and re-encoded in WebP format (REQ-022). Original byte streams are never preserved on our storage volumes.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          3. Session Cookies and Tracking
        </h2>
        <p>
          We use strictly necessary first-party session cookies with <code className="font-mono text-xs bg-neutral-100 dark:bg-neutral-700 px-1 py-0.5 rounded">HttpOnly</code>, <code className="font-mono text-xs bg-neutral-100 dark:bg-neutral-700 px-1 py-0.5 rounded">SameSite=Lax</code>, and <code className="font-mono text-xs bg-neutral-100 dark:bg-neutral-700 px-1 py-0.5 rounded">Secure</code> flags. We employ no third-party behavioral advertising trackers, beacons, or invasive analytics pixels.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
          4. GDPR Data Portability & The Right to Erasure
        </h2>
        <p>
          Under GDPR Articles 17 and 20, you retain full rights to:
        </p>
        <ul className="list-disc list-inside space-y-1 text-xs pl-2">
          <li>
            <strong>Export:</strong> Download a full structured JSON archive of your personal profile, posts, comments, likes, events, and ledger records directly from the Settings page.
          </li>
          <li>
            <strong>Erasure:</strong> Permanently delete your account. Deletion immediately removes your PII, invalidates active sessions, and anonymizes public interactions according to platform retention policy RUL-022.
          </li>
        </ul>
      </section>
    </article>
  );
};
