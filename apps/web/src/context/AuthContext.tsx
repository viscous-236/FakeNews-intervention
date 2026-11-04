/**
 * Auth Context and Provider (TASK-077).
 *
 * Manages signed-in state, user identity, permissions, and logout flows.
 */

import React, { createContext, useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { Me } from '../types';

export interface AuthContextValue {
  user: Me | null;
  me: Me | null;
  isLoading: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
  refetchUser: () => Promise<void>;
  refreshMe: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (data: { email: string; username: string; displayName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const queryClient = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ user: Me }>({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient.get<{ user: Me }>('/api/v1/auth/me'),
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 min
  });

  const user = data?.user ?? null;
  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin';

  const refetchUser = async () => {
    await refetch();
  };

  const login = async (identifier: string, password: string) => {
    await apiClient.post('/api/v1/auth/login', { identifier, password });
    await refetch();
  };

  const register = async (regData: { email: string; username: string; displayName: string; password: string }) => {
    await apiClient.post('/api/v1/auth/register', regData);
    await refetch();
  };

  const logout = async () => {
    setIsLoggingOut(true);
    try {
      await apiClient.post('/api/v1/auth/logout');
    } catch {
      // Ignore network errors on logout
    } finally {
      queryClient.setQueryData(['auth', 'me'], null);
      queryClient.clear();
      setIsLoggingOut(false);
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        me: user,
        isLoading: isLoading || isLoggingOut,
        isAdmin,
        isAuthenticated,
        refetchUser,
        refreshMe: refetchUser,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useMe(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useMe must be used within an AuthProvider');
  }
  return context;
}

export function useAuth(): AuthContextValue {
  return useMe();
}
