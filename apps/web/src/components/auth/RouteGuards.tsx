/** Route protection guards (TASK-077). */

import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useMe } from '../../context/AuthContext';
import { LoadingBlock } from '../ui/Page';

export function ProtectedRoute(): React.ReactElement {
  const { user, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <LoadingBlock />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

export function AdminRoute(): React.ReactElement {
  const { user, isLoading, isAdmin } = useMe();
  if (isLoading) return <LoadingBlock />;
  if (!user || !isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function GuestRoute(): React.ReactElement {
  const { user, isLoading } = useMe();
  if (isLoading) return <LoadingBlock />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
