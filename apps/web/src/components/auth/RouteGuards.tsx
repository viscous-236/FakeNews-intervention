/**
 * Route protection guards (TASK-077).
 */

import React from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useMe } from '../../context/AuthContext';
import { copy } from '../../copy';

export function ProtectedRoute({ children }: { children?: React.ReactElement }): React.ReactElement {
  const { user, isLoading } = useMe();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm font-medium text-neutral-500 animate-pulse">{copy.loading}</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children ?? <Outlet />;
}

export function AdminRoute({ children }: { children?: React.ReactElement }): React.ReactElement {
  const { user, isLoading, isAdmin } = useMe();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm font-medium text-neutral-500 animate-pulse">{copy.loading}</p>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children ?? <Outlet />;
}

export function GuestRoute({ children }: { children?: React.ReactElement }): React.ReactElement {
  const { user, isLoading } = useMe();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm font-medium text-neutral-500 animate-pulse">{copy.loading}</p>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return children ?? <Outlet />;
}
