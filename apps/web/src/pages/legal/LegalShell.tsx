import React from 'react';
import { copy } from '../../copy';

/** Reading surface: one column at a 72-character measure, 16px body. */
export function LegalShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <article className="mx-auto max-w-reading">
      <h1 className="text-title text-ink">{title}</h1>
      <p className="mt-1 text-small text-muted">{copy.legal.updated}</p>
      <p className="mt-4 text-prose text-ink">{intro}</p>
      <div className="mt-8 space-y-8 text-prose text-ink [&_h2]:text-section [&_h2]:text-ink [&_p]:mt-2 [&_p]:text-muted [&_li]:text-muted [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_code]:font-mono [&_code]:text-body">
        {children}
      </div>
    </article>
  );
}
