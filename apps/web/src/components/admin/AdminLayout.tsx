import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { copy } from '../../copy';
import {
  LayoutDashboard,
  Inbox,
  Scale,
  Waves,
  Users,
  ShieldAlert,
  CheckCheck,
  BarChart2,
} from 'lucide-react';

export const AdminLayout: React.FC = () => {
  const tabs = [
    { to: '/admin', label: copy.admin.overviewTab, icon: LayoutDashboard, end: true },
    { to: '/admin/queue', label: copy.admin.queueTab, icon: Inbox },
    { to: '/admin/appeals', label: copy.admin.appealsTab, icon: Scale },
    { to: '/admin/waves', label: copy.admin.wavesTab, icon: Waves },
    { to: '/admin/users', label: copy.admin.usersTab, icon: Users },
    { to: '/admin/audit', label: copy.admin.auditTab, icon: ShieldAlert },
    { to: '/admin/verify', label: copy.admin.verifyTab, icon: CheckCheck },
    { to: '/admin/analytics', label: copy.admin.analyticsTab, icon: BarChart2 },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-neutral-200 dark:border-neutral-700 pb-3">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
          {copy.admin.title}
        </h1>
        <p className="text-xs text-neutral-500 mt-0.5">
          Platform fact-checking governance, reputation waves, and mathematical verification.
        </p>
      </div>

      {/* Admin Horizontal Tabs */}
      <nav
        className="flex items-center gap-1.5 overflow-x-auto border-b border-neutral-200 dark:border-neutral-700 pb-2 scrollbar-none"
        aria-label="Admin Sections"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors min-h-[40px] ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="pt-2">
        <Outlet />
      </div>
    </div>
  );
};
