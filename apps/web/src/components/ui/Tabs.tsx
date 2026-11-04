import React from 'react';
import { NavLink } from 'react-router-dom';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Underline tabs on a full-width 1px rule; the indicator is 2px in the accent. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: TabItem<T>[];
  label: string;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-6 border-b border-border overflow-x-auto scrollbar-none"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={`-mb-px flex h-10 items-center gap-2 whitespace-nowrap border-b-2 text-body transition-colors ${
              active
                ? 'border-accent font-semibold text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="num text-small text-muted">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Same look, but each tab is a route. */
export function LinkTabs({
  items,
  label,
}: {
  items: Array<{ to: string; label: string; end?: boolean; count?: number }>;
  label: string;
}): React.ReactElement {
  return (
    <nav
      aria-label={label}
      className="flex gap-6 border-b border-border overflow-x-auto scrollbar-none"
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `-mb-px flex h-10 items-center gap-2 whitespace-nowrap border-b-2 text-body transition-colors ${
              isActive
                ? 'border-accent font-semibold text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`
          }
        >
          {item.label}
          {item.count !== undefined && item.count > 0 ? (
            <span className="num text-small text-muted">{item.count}</span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}
