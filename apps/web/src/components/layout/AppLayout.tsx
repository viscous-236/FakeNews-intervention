/**
 * The shell: one tinted L-frame (sidebar + 48px top bar, no rule between
 * them) and a white sheet inset 8px from the window's right and bottom
 * edges. Colour lives only in data; the chrome stays grey.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  FileText,
  Home,
  LogOut,
  Mail,
  Menu as MenuIcon,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { useMe } from '../../context/AuthContext';
import { copy } from '../../copy';
import { useUnreadCount } from '../../api/hooks';
import { useNotificationStream } from '../../hooks/useNotificationStream';
import { Avatar } from '../ui/Avatar';
import { CountBadge } from '../ui/Pill';
import { Button } from '../ui/Button';
import { AccountStatusBanner } from './AccountStatusBanner';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  count?: number;
}

function Wordmark(): React.ReactElement {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 text-ink" title={copy.app.name}>
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-control bg-accent text-[11px] font-semibold text-white"
      >
        Q
      </span>
      <span className="truncate text-body font-semibold leading-tight">{copy.app.shortName}</span>
    </NavLink>
  );
}

function NavList({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}): React.ReactElement {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex h-[34px] items-center gap-2.5 rounded-control px-2.5 text-body transition-colors ${
                  isActive
                    ? 'bg-active font-medium text-ink'
                    : 'text-muted hover:bg-active/60 hover:text-ink'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.count ? (
                <CountBadge count={item.count} label={copy.notifications.unreadCount(item.count)} />
              ) : null}
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}

function SearchBox({ compact = false }: { compact?: boolean }): React.ReactElement {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  return (
    <form
      role="search"
      className={compact ? 'w-full' : 'w-full max-w-[548px]'}
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q.length >= 2) navigate(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <label htmlFor="global-search" className="sr-only">
        {copy.app.nav.search}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          id="global-search"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={copy.app.searchPlaceholder}
          className="h-8 w-full rounded-control border border-control bg-surface pl-9 pr-3 text-body placeholder:text-faint"
        />
      </div>
    </form>
  );
}

export function AppLayout(): React.ReactElement {
  const { user, isAuthenticated, isAdmin, logout } = useMe();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const streamState = useNotificationStream();
  const unread = useUnreadCount(isAuthenticated, streamState === 'polling' ? 30_000 : false);
  const unreadCount = unread.data?.count ?? 0;

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    closeMenu();
  }, [location.pathname, closeMenu]);

  const primary: NavItem[] = [
    { label: copy.app.nav.home, to: '/', icon: Home, end: true },
    { label: copy.app.nav.search, to: '/search', icon: Search },
    ...(isAuthenticated
      ? [
          {
            label: copy.app.nav.notifications,
            to: '/notifications',
            icon: Bell,
            count: unreadCount,
          },
          { label: copy.app.nav.messages, to: '/messages', icon: Mail },
          { label: copy.app.nav.score, to: '/score', icon: Scale },
          { label: copy.app.nav.appeals, to: '/appeals', icon: FileText },
        ]
      : []),
  ];
  const secondary: NavItem[] =
    isAuthenticated && user
      ? [
          { label: copy.app.nav.profile, to: `/u/${user.username}`, icon: User },
          { label: copy.app.nav.settings, to: '/settings', icon: Settings },
          ...(isAdmin ? [{ label: copy.app.nav.admin, to: '/admin', icon: ShieldCheck }] : []),
        ]
      : [];

  const isAdminArea = location.pathname.startsWith('/admin');

  return (
    <div className="min-h-screen bg-frame">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 hidden w-sidebar flex-col px-3 pb-3 pt-3 lg:flex">
        <div className="px-2.5 pb-4 pt-1">
          <Wordmark />
        </div>
        <nav className="flex-1 overflow-y-auto" aria-label="Primary">
          <NavList items={primary} />
          {secondary.length ? (
            <div className="mt-5">
              <p className="mb-1 px-2.5 text-small text-muted">{copy.app.nav.profile}</p>
              <NavList items={secondary} />
            </div>
          ) : null}
        </nav>
        <div className="mt-3 space-y-3 px-1">
          {isAuthenticated && user ? (
            <div className="flex items-center gap-2.5">
              <Avatar
                avatarUrl={user.avatarUrl}
                displayName={user.displayName}
                username={user.username}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-ink">{user.displayName}</p>
                <p className="truncate text-small text-muted">@{user.username}</p>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-active hover:text-ink"
                aria-label={copy.app.nav.logout}
                title={copy.app.nav.logout}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button variant="primary" onClick={() => (window.location.href = '/login')}>
                {copy.app.nav.login}
              </Button>
              <Button variant="secondary" onClick={() => (window.location.href = '/register')}>
                {copy.app.nav.register}
              </Button>
            </div>
          )}
          <nav
            aria-label={copy.app.nav.legal}
            className="flex flex-wrap gap-x-3 px-1 text-small text-muted"
          >
            <NavLink to="/legal/terms" className="hover:text-ink">
              {copy.app.footer.terms}
            </NavLink>
            <NavLink to="/legal/privacy" className="hover:text-ink">
              {copy.app.footer.privacy}
            </NavLink>
            <NavLink to="/legal/guidelines" className="hover:text-ink">
              {copy.app.footer.guidelines}
            </NavLink>
          </nav>
        </div>
      </aside>

      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-topbar items-center gap-3 bg-frame px-4 lg:left-sidebar lg:px-6">
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-control text-ink hover:bg-active lg:hidden"
          aria-label={menuOpen ? copy.app.nav.closeMenu : copy.app.nav.menu}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <MenuIconClosed /> : <MenuIcon className="h-5 w-5" aria-hidden="true" />}
        </button>
        <div className="lg:hidden">
          <Wordmark />
        </div>
        <div className="hidden flex-1 justify-center lg:flex">
          <SearchBox />
        </div>
        <div className="ml-auto flex items-center gap-1">
          {isAuthenticated ? (
            <NavLink
              to="/notifications"
              className="relative grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-active hover:text-ink lg:hidden"
              aria-label={copy.app.nav.notifications}
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {unreadCount > 0 ? (
                <span
                  className="absolute right-1 top-1 h-2 w-2 rounded-full bg-negative"
                  aria-hidden="true"
                />
              ) : null}
            </NavLink>
          ) : null}
          {isAuthenticated && user ? (
            <NavLink
              to={`/u/${user.username}`}
              className="rounded-full"
              aria-label={copy.app.nav.profile}
            >
              <Avatar
                avatarUrl={user.avatarUrl}
                displayName={user.displayName}
                username={user.username}
                size="sm"
              />
            </NavLink>
          ) : (
            <NavLink
              to="/login"
              className="text-body font-medium text-ink hover:underline lg:hidden"
            >
              {copy.app.nav.login}
            </NavLink>
          )}
        </div>
      </header>

      {/* Mobile menu sheet */}
      {menuOpen ? (
        <div
          id="mobile-menu"
          className="fixed inset-x-0 bottom-0 top-topbar z-30 overflow-y-auto bg-frame px-4 pb-6 pt-2 lg:hidden"
        >
          <div className="mb-3">
            <SearchBox compact />
          </div>
          <NavList items={primary} onNavigate={closeMenu} />
          {secondary.length ? (
            <div className="mt-5">
              <NavList items={secondary} onNavigate={closeMenu} />
            </div>
          ) : null}
          <div className="mt-6 flex flex-col gap-2">
            {isAuthenticated ? (
              <Button variant="secondary" icon={<LogOut />} onClick={() => void logout()}>
                {copy.app.nav.logout}
              </Button>
            ) : (
              <>
                <Button variant="primary" onClick={() => (window.location.href = '/login')}>
                  {copy.app.nav.login}
                </Button>
                <Button variant="secondary" onClick={() => (window.location.href = '/register')}>
                  {copy.app.nav.register}
                </Button>
              </>
            )}
          </div>
          <nav
            aria-label={copy.app.nav.legal}
            className="mt-6 flex gap-4 px-1 text-small text-muted"
          >
            <NavLink to="/legal/terms">{copy.app.footer.terms}</NavLink>
            <NavLink to="/legal/privacy">{copy.app.footer.privacy}</NavLink>
            <NavLink to="/legal/guidelines">{copy.app.footer.guidelines}</NavLink>
          </nav>
        </div>
      ) : null}

      {/* The sheet */}
      <main id="main" className="min-h-screen pt-topbar lg:pl-sidebar">
        <div className="min-h-[calc(100vh-48px)] bg-surface lg:mb-2 lg:mr-2 lg:min-h-[calc(100vh-56px)] lg:rounded-sheet lg:border lg:border-border">
          <div
            className={`mx-auto w-full px-5 py-5 sm:px-6 ${isAdminArea ? 'max-w-[1400px]' : 'max-w-sheet'}`}
          >
            {isAuthenticated ? <AccountStatusBanner /> : null}
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

function MenuIconClosed(): React.ReactElement {
  return <X className="h-5 w-5" aria-hidden="true" />;
}
