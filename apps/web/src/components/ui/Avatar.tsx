import React from 'react';

export function Avatar({
  src,
  avatarUrl,
  name,
  displayName,
  username,
  size = 'md',
  className = '',
}: {
  src?: string | null;
  avatarUrl?: string | null;
  name?: string;
  displayName?: string;
  username?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}): React.ReactElement {
  const finalSrc = avatarUrl !== undefined ? avatarUrl : src;
  const finalName = displayName || name || username || '';

  const sizeStyles = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-14 w-14 text-base font-semibold',
    xl: 'h-20 w-20 text-xl font-bold',
  };

  const initials = finalName
    ? finalName
        .trim()
        .split(/\s+/)
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : username
    ? username.slice(0, 2).toUpperCase()
    : '?';

  if (finalSrc) {
    return (
      <img
        src={finalSrc}
        alt={finalName ? `${finalName}'s avatar` : 'User avatar'}
        className={`rounded-full object-cover shrink-0 ring-1 ring-neutral-200 dark:ring-neutral-800 ${sizeStyles[size]} ${className}`}
      />
    );
  }

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-200 font-medium text-neutral-700 ring-1 ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700 ${sizeStyles[size]} ${className}`}
      aria-label={finalName ? `${finalName}'s avatar` : 'User avatar'}
    >
      {initials}
    </div>
  );
}
