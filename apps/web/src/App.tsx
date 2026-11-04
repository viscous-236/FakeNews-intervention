import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute, AdminRoute, GuestRoute } from './components/auth/RouteGuards';

// Pages
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage';
import { PostDetailPage } from './pages/PostDetailPage';
import { ProfilePage } from './pages/ProfilePage';
import { SearchPage } from './pages/SearchPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { MessagesPage } from './pages/MessagesPage';
import { ScorePage } from './pages/ScorePage';
import { AppealsPage } from './pages/AppealsPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Legal Pages
import { TermsPage } from './pages/legal/TermsPage';
import { PrivacyPage } from './pages/legal/PrivacyPage';
import { GuidelinesPage } from './pages/legal/GuidelinesPage';

// Admin Pages
import { AdminLayout } from './components/admin/AdminLayout';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { AdminQueuePage } from './pages/admin/AdminQueuePage';
import { AdminReviewWorkspacePage } from './pages/admin/AdminReviewWorkspacePage';
import { AdminAppealsPage } from './pages/admin/AdminAppealsPage';
import { AdminWavesPage } from './pages/admin/AdminWavesPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminAuditPage } from './pages/admin/AdminAuditPage';
import { AdminVerifyPage } from './pages/admin/AdminVerifyPage';
import { AdminAnalyticsPage } from './pages/admin/AdminAnalyticsPage';

export default function App(): React.ReactElement {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Public / Core Feed */}
          <Route path="/" element={<HomePage />} />
          <Route path="/p/:id" element={<PostDetailPage />} />
          <Route path="/u/:username" element={<ProfilePage />} />
          <Route path="/u/:username/followers" element={<ProfilePage />} />
          <Route path="/u/:username/following" element={<ProfilePage />} />
          <Route path="/search" element={<SearchPage />} />

          {/* Legal Pages */}
          <Route path="/legal/terms" element={<TermsPage />} />
          <Route path="/legal/privacy" element={<PrivacyPage />} />
          <Route path="/legal/guidelines" element={<GuidelinesPage />} />

          {/* Guest Only Auth Routes */}
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>

          {/* Email & Password Flow */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />

          {/* Protected Member Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:username" element={<MessagesPage />} />
            <Route path="/score" element={<ScorePage />} />
            <Route path="/appeals" element={<AppealsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          {/* Admin Protected Suite */}
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminLayout />}>
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

          {/* 404 Catch-all */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
