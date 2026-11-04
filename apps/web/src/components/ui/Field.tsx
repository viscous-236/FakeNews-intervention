import React, { useId } from 'react';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  id: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}

/** Label above the control, hint and error tied to it with aria-describedby. */
function FieldShell({
  label,
  hint,
  error,
  optional,
  id,
  children,
  trailing,
}: FieldShellProps): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-body font-medium text-ink">
          {label}
          {optional ? <span className="ml-1.5 font-normal text-muted">(optional)</span> : null}
        </label>
        {trailing}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-small text-negative">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-small text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlClass =
  'block w-full rounded-control border bg-surface px-3 text-body text-ink placeholder:text-faint disabled:bg-raised disabled:text-muted transition-colors';

function describedBy(id: string, error?: string | null, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  id?: string;
  trailing?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, optional, id: idProp, className = '', trailing, ...props },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      id={id}
      trailing={trailing}
    >
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${controlClass} h-10 ${error ? 'border-negative' : 'border-control'} ${className}`}
        {...props}
      />
    </FieldShell>
  );
});

export interface TextareaProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  id?: string;
  trailing?: React.ReactNode;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, optional, id: idProp, className = '', rows = 4, trailing, ...props },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      id={id}
      trailing={trailing}
    >
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${controlClass} py-2 leading-5 resize-y ${error ? 'border-negative' : 'border-control'} ${className}`}
        {...props}
      />
    </FieldShell>
  );
});

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  id?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, id: idProp, className = '', children, ...props },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} id={id}>
      <select
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${controlClass} h-10 ${error ? 'border-negative' : 'border-control'} ${className}`}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});

/** Character counter rendered beside a field label. */
export function CharCount({ value, max }: { value: number; max: number }): React.ReactElement {
  const over = value > max;
  return (
    <span className={`num text-small ${over ? 'text-negative' : 'text-muted'}`} aria-live="polite">
      {value} / {max}
    </span>
  );
}
