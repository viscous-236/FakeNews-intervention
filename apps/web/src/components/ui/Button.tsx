import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
  size?: 'sm' | 'md';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-primary text-primary-ink hover:bg-primary-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-control hover:bg-raised',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-raised',
  danger: 'bg-surface text-negative border border-negative/40 hover:bg-negative-bg',
  link: 'bg-transparent text-accent border border-transparent hover:underline px-0',
};

const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-small font-medium gap-1.5',
  md: 'h-9 px-3.5 text-body font-medium gap-2',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className = '',
    variant = 'secondary',
    size = 'md',
    isLoading = false,
    icon,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-control transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-px ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <Spinner />
      ) : icon ? (
        <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      ) : null}
      {children}
    </button>
  );
});

export function Spinner({ className = '' }: { className?: string }): React.ReactElement {
  return (
    <svg
      className={`h-4 w-4 animate-spin shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
    </svg>
  );
}

/** A square icon-only control, 32px, with an accessible name. */
export function IconButton({
  label,
  className = '',
  active = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-control transition-colors disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4 ${
        active ? 'bg-active text-ink' : 'text-muted hover:bg-raised hover:text-ink'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
