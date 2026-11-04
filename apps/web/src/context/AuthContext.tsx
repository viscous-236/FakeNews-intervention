/**
 * Auth context (TASK-077): signed-in state, identity and auth flows.
 * The server owns the session; this only mirrors GET /auth/me.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, isApiError } from '../api/client';
import { keys } from '../api/hooks';
import type { Me } from '../types';

export interface AuthContextValue {
  user: Me | null;
  me: Me | null;
  isLoading: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
  /** Signed in and status active: may post, like, share, comment. */
  canAct: boolean;
  refetchUser: () => Promise<void>;
  refreshMe: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const queryClient = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ user: Me } | null>({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await apiClient.get<{ user: Me }>('/api/v1/auth/me');
      } catch (err) {
        if (isApiError(err) && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  const user = data?.user ?? null;

  const refetchUser = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await apiClient.post<{ user: Me }>('/api/v1/auth/login', {
        identifier,
        password,
      });
      queryClient.setQueryData(keys.me, res);
    },
    [queryClient],
  );

  const register = useCallback(
    async (regData: { email: string; username: string; displayName: string; password: string }) => {
      const res = await apiClient.post<{ user: Me }>('/api/v1/auth/register', regData);
      queryClient.setQueryData(keys.me, res);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await apiClient.post('/api/v1/auth/logout');
    } catch {
      // The session may already be gone; clear local state regardless.
    } finally {
      queryClient.clear();
      setIsLoggingOut(false);
      window.location.assign('/login');
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      me: user,
      isLoading: isLoading || isLoggingOut,
      isAdmin: user?.role === 'admin',
      isAuthenticated: Boolean(user),
      canAct: Boolean(user && user.status === 'active'),
      refetchUser,
      refreshMe: refetchUser,
      login,
      register,
      logout,
    }),
    [user, isLoading, isLoggingOut, refetchUser, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useMe(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useMe must be used within an AuthProvider');
  return context;
}

export function useAuth(): AuthContextValue {
  return useMe();
}
