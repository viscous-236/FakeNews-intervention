import React from 'react';

/**
 * Renders user text as plain text with http(s) links auto-linked (REQ-027).
 * Nothing is interpreted as HTML.
 */
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

export function PostBody({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}): React.ReactElement {
  const parts = text.split(URL_RE);
  return (
    <p className={`whitespace-pre-wrap break-words text-prose text-ink ${className}`}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent underline-offset-2 hover:underline break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </p>
  );
}
