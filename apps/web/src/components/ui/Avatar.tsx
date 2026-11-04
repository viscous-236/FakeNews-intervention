import React from 'react';

/**
 * People are shown as themselves: a stable initial on a pale tint derived
 * from the username, so the same person always carries the same colour.
 */

const sizes = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-small',
  md: 'h-10 w-10 text-body',
  lg: 'h-14 w-14 text-section',
  xl: 'h-20 w-20 text-title',
} as const;

function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Avatar({
  avatarUrl,
  displayName,
  username,
  size = 'md',
  className = '',
}: {
  avatarUrl: string | null | undefined;
  displayName: string;
  username: string;
  size?: keyof typeof sizes;
  className?: string;
}): React.ReactElement {
  const label = `${displayName} (@${username})`;
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={label}
        width={40}
        height={40}
        loading="lazy"
        className={`shrink-0 rounded-full object-cover bg-raised ${sizes[size]} ${className}`}
      />
    );
  }
  const hue = hueFor(username);
  const initial = (displayName.trim()[0] ?? username[0] ?? '?').toUpperCase();
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium ${sizes[size]} ${className}`}
      style={{ background: `hsl(${hue} 45% 92%)`, color: `hsl(${hue} 40% 28%)` }}
    >
      {initial}
    </span>
  );
}
