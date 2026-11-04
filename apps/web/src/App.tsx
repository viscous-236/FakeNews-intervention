import React, { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { AdminRoute, GuestRoute, ProtectedRoute } from './components/auth/RouteGuards';
import { LoadingBlock } from './components/ui/Page';

import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { PostDetailPage } from './pages/PostDetailPage';
import { ProfilePage } from './pages/ProfilePage';
import { SearchPage } from './pages/SearchPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { MessagesPage } from './pages/MessagesPage';
import { ScorePage } from './pages/ScorePage';
import { AppealsPage } from './pages/AppealsPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { TermsPage } from './pages/legal/TermsPage';
import { PrivacyPage } from './pages/legal/PrivacyPage';
import { GuidelinesPage } from './pages/legal/GuidelinesPage';

// The admin suite (and its chart library) only loads for administrators.
const AdminLayout = lazy(() =>
  import('./components/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
);
const AdminOverviewPage = lazy(() =>
  import('./pages/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })),
);
const AdminQueuePage = lazy(() =>
  import('./pages/admin/AdminQueuePage').then((m) => ({ default: m.AdminQueuePage })),
);
const AdminReviewWorkspacePage = lazy(() =>
  import('./pages/admin/AdminReviewWorkspacePage').then((m) => ({
    default: m.AdminReviewWorkspacePage,
  })),
);
const AdminAppealsPage = lazy(() =>
  import('./pages/admin/AdminAppealsPage').then((m) => ({ default: m.AdminAppealsPage })),
);
const AdminWavesPage = lazy(() =>
  import('./pages/admin/AdminWavesPage').then((m) => ({ default: m.AdminWavesPage })),
);
const AdminUsersPage = lazy(() =>
  import('./pages/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminAuditPage = lazy(() =>
  import('./pages/admin/AdminAuditPage').then((m) => ({ default: m.AdminAuditPage })),
);
const AdminVerifyPage = lazy(() =>
  import('./pages/admin/AdminVerifyPage').then((m) => ({ default: m.AdminVerifyPage })),
);
const AdminAnalyticsPage = lazy(() =>
  import('./pages/admin/AdminAnalyticsPage').then((m) => ({ default: m.AdminAnalyticsPage })),
);

/** Routes per plan Section 1.8. */
export default function App(): React.ReactElement {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/p/:id" element={<PostDetailPage />} />
          <Route path="/u/:username" element={<ProfilePage />} />
          <Route path="/u/:username/followers" element={<ProfilePage />} />
          <Route path="/u/:username/following" element={<ProfilePage />} />
          <Route path="/search" element={<SearchPage />} />

          <Route path="/legal/terms" element={<TermsPage />} />
          <Route path="/legal/privacy" element={<PrivacyPage />} />
          <Route path="/legal/guidelines" element={<GuidelinesPage />} />

          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:username" element={<MessagesPage />} />
            <Route path="/score" element={<ScorePage />} />
            <Route path="/appeals" element={<AppealsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route element={<AdminRoute />}>
            <Route
              path="/admin"
              element={
                <Suspense fallback={<LoadingBlock />}>
                  <AdminLayout />
                </Suspense>
              }
            >
              <Route index element={<AdminOverviewPage />} />
              <Route path="queue" element={<AdminQueuePage />} />
              <Route path="posts/:id" element={<AdminReviewWorkspacePage />} />
              <Route path="appeals" element={<AdminAppealsPage />} />
              <Route path="waves" element={<AdminWavesPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="audit" element={<AdminAuditPage />} />
              <Route path="verify" element={<AdminVerifyPage />} />
              <Route path="analytics" element={<AdminAnalyticsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
