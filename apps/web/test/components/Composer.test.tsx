import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Composer } from '../../src/components/posts/Composer';
import { copy } from '../../src/copy';
import * as AuthContextModule from '../../src/context/AuthContext';
import { Me } from '../../src/types';

const mockNeutralUser: Me = {
  id: 'u-composer-1',
  username: 'charlie',
  email: 'charlie@example.com',
  displayName: 'Charlie Davis',
  bio: '',
  avatarUrl: null,
  role: 'user',
  status: 'active',
  emailVerified: true,
  score: {
    q: '0.000',
    sigma: '0.500',
    tier: 'neutral',
  },
  createdAt: new Date().toISOString(),
};

describe('Composer', () => {
  it('enforces 20-character minimum length constraint', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: mockNeutralUser,
      me: mockNeutralUser,
      isLoading: false,
      isAdmin: false,
      isAuthenticated: true,
      refetchUser: vi.fn(),
      refreshMe: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(<Composer />);

    const textarea = screen.getByPlaceholderText(copy.composer.placeholder);
    const postBtn = screen.getByRole('button', { name: copy.composer.publish });

    // Initially empty - disabled
    expect((postBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('0 / 500')).toBeDefined();

    // 10 characters (< 20 minimum) - still disabled
    fireEvent.change(textarea, { target: { value: 'Too short!' } });
    expect((postBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('10 / 500')).toBeDefined();

    // 25 characters (>= 20 minimum) - enabled
    fireEvent.change(textarea, {
      target: { value: 'This is a valid claim meeting the twenty character length requirement.' },
    });
    expect((postBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('displays low-tier warning banner when user credibility tier is low', () => {
    const lowTierUser: Me = {
      ...mockNeutralUser,
      score: {
        q: '-2.000',
        sigma: '0.500',
        tier: 'low',
      },
    };

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: lowTierUser,
      me: lowTierUser,
      isLoading: false,
      isAdmin: false,
      isAuthenticated: true,
      refetchUser: vi.fn(),
      refreshMe: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(<Composer />);

    expect(screen.getByText(copy.composer.lowTierWarning)).toBeDefined();
  });
});
