import React from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../src/context/AuthContext';
import type { Me } from '../src/types';

/** Renders with the providers every component expects (router, query client, auth). */
export function renderWithProviders(ui: React.ReactElement, options?: { withAuth?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const withAuth = options?.withAuth ?? true;
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{withAuth ? <AuthProvider>{ui}</AuthProvider> : ui}</BrowserRouter>
    </QueryClientProvider>,
  );
}

export const neutralUser: Me = {
  id: 'u-1',
  username: 'charlie',
  email: 'charlie@example.com',
  displayName: 'Charlie Davis',
  bio: '',
  avatarUrl: null,
  role: 'user',
  status: 'active',
  score: { q: '0.000', sigma: '0.500', tier: 'neutral' },
  createdAt: new Date().toISOString(),
};

export function authValue(user: Me) {
  return {
    user,
    me: user,
    isLoading: false,
    isAdmin: user.role === 'admin',
    isAuthenticated: true,
    canAct: user.status === 'active',
    refetchUser: async () => {},
    refreshMe: async () => {},
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}
