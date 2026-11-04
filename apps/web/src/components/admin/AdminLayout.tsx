import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { copy } from '../../copy';
import { useAdminOverview } from '../../api/hooks';
import { LinkTabs } from '../ui/Tabs';
import { LoadingBlock } from '../ui/Page';

export function AdminLayout(): React.ReactElement {
  const overview = useAdminOverview();
  const tabs = [
    { to: '/admin', label: copy.admin.nav.overview, end: true },
    { to: '/admin/queue', label: copy.admin.nav.queue, count: overview.data?.openQueue },
    { to: '/admin/appeals', label: copy.admin.nav.appeals, count: overview.data?.openAppeals },
    { to: '/admin/waves', label: copy.admin.nav.waves },
    { to: '/admin/users', label: copy.admin.nav.users },
    { to: '/admin/audit', label: copy.admin.nav.audit },
    { to: '/admin/verify', label: copy.admin.nav.verify },
    { to: '/admin/analytics', label: copy.admin.nav.analytics },
  ];

  return (
    <div>
      <div className="mb-6">
        <LinkTabs label={copy.admin.title} items={tabs} />
      </div>
      <Suspense fallback={<LoadingBlock />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
