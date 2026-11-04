import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Home,
  Search,
  Bell,
  Mail,
  Award,
  User,
  Settings,
  Shield,
  LogOut,
  LogIn,
  FileText,
} from 'lucide-react';
import { useMe } from '../../context/AuthContext';
import { copy } from '../../copy';
import { Avatar } from '../ui/Avatar';
import { TierBadge } from '../ui/Badge';

export function AppLayout(): React.ReactElement {
  const { user, isAuthenticated, isAdmin, logout } = useMe();
  const navigate = useNavigate();

  const navItems = [
    { label: copy.app.nav.home, path: '/', icon: Home, exact: true },
    { label: copy.app.nav.search, path: '/search', icon: Search },
    ...(isAuthenticated
      ? [
          { label: copy.app.nav.notifications, path: '/notifications', icon: Bell },
          { label: copy.app.nav.messages, path: '/messages', icon: Mail },
          { label: copy.app.nav.score, path: '/score', icon: Award },
          { label: copy.app.nav.appeals, path: '/appeals', icon: FileText },
          { label: copy.app.nav.profile, path: `/u/${user?.username}`, icon: User },
          { label: copy.app.nav.settings, path: '/settings', icon: Settings },
        ]
      : []),
    ...(isAdmin
      ? [{ label: copy.app.nav.admin, path: '/admin', icon: Shield }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col md:flex-row justify-center">
      {/* Mobile Top Header */}
      <header className="md:hidden sticky top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between">
        <NavLink to="/" className="font-bold text-lg text-indigo-600 dark:text-indigo-400">
          {copy.app.name}
        </NavLink>
        {isAuthenticated && user ? (
          <NavLink to={`/u/${user.username}`}>
            <Avatar src={user.avatarUrl} name={user.displayName} size="sm" />
          </NavLink>
        ) : (
          <NavLink
            to="/login"
            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400"
          >
            {copy.app.nav.login}
          </NavLink>
        )}
      </header>

      {/* Desktop Sidebar Navigation */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 p-4 sticky top-0 h-screen justify-between">
        <div className="space-y-6">
          <div className="px-3 py-2">
            <NavLink to="/" className="block">
              <span className="font-extrabold text-xl tracking-tight text-indigo-600 dark:text-indigo-400">
                {copy.app.name}
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {copy.app.tagline}
              </span>
            </NavLink>
          </div>

          <nav className="space-y-1" aria-label="Main Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.exact}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400 font-semibold'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60'
                    }`
                  }
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* User Card & Auth Actions */}
        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
          {isAuthenticated && user ? (
            <div className="space-y-3">
              <NavLink
                to={`/u/${user.username}`}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Avatar src={user.avatarUrl} name={user.displayName} size="md" />
                <div className="overflow-hidden flex-1">
                  <div className="font-semibold text-sm truncate text-slate-900 dark:text-slate-100">
                    {user.displayName}
                  </div>
                  <div className="text-xs text-slate-500 truncate">@{user.username}</div>
                  <div className="mt-1">
                    <TierBadge tier={user.score.tier} />
                  </div>
                </div>
              </NavLink>

              <button
                type="button"
                onClick={() => void logout()}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[44px]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>{copy.app.nav.logout}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 min-h-[44px]"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                <span>{copy.app.nav.login}</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/register')}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[44px]"
              >
                <span>{copy.app.nav.register}</span>
              </button>
            </div>
          )}

          {/* Legal Links */}
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-900">
            <NavLink to="/legal/terms" className="hover:underline">Terms</NavLink>
            <span>•</span>
            <NavLink to="/legal/privacy" className="hover:underline">Privacy</NavLink>
            <span>•</span>
            <NavLink to="/legal/guidelines" className="hover:underline">Guidelines</NavLink>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 max-w-2xl min-h-screen border-r border-slate-200 dark:border-slate-800 pb-20 md:pb-8">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation (< 768px) */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 flex justify-around items-center px-2 py-1"
        aria-label="Mobile Navigation"
      >
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `p-2.5 rounded-lg flex flex-col items-center justify-center min-h-[44px] min-w-[44px] ${
              isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
            }`
          }
          aria-label={copy.app.nav.home}
        >
          <Home className="h-5 w-5" aria-hidden="true" />
        </NavLink>
        <NavLink
          to="/search"
          className={({ isActive }) =>
            `p-2.5 rounded-lg flex flex-col items-center justify-center min-h-[44px] min-w-[44px] ${
              isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
            }`
          }
          aria-label={copy.app.nav.search}
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </NavLink>
        {isAuthenticated && (
          <>
            <NavLink
              to="/notifications"
              className={({ isActive }) =>
                `p-2.5 rounded-lg flex flex-col items-center justify-center min-h-[44px] min-w-[44px] ${
                  isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
                }`
              }
              aria-label={copy.app.nav.notifications}
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
            </NavLink>
            <NavLink
              to="/score"
              className={({ isActive }) =>
                `p-2.5 rounded-lg flex flex-col items-center justify-center min-h-[44px] min-w-[44px] ${
                  isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
                }`
              }
              aria-label={copy.app.nav.score}
            >
              <Award className="h-5 w-5" aria-hidden="true" />
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `p-2.5 rounded-lg flex flex-col items-center justify-center min-h-[44px] min-w-[44px] ${
                  isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
                }`
              }
              aria-label={copy.app.nav.settings}
            >
              <Settings className="h-5 w-5" aria-hidden="true" />
            </NavLink>
          </>
        )}
      </nav>
    </div>
  );
}
