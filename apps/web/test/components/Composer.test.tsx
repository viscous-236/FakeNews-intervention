import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Composer } from '../../src/components/posts/Composer';
import { copy } from '../../src/copy';
import * as AuthContextModule from '../../src/context/AuthContext';
import { authValue, neutralUser, renderWithProviders } from '../helpers';

afterEach(() => vi.restoreAllMocks());

describe('Composer', () => {
  it('enforces the 20-character minimum before enabling Post', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(authValue(neutralUser));
    renderWithProviders(<Composer />, { withAuth: false });

    const textarea = screen.getByPlaceholderText(copy.composer.placeholder);
    const postBtn = screen.getByRole('button', { name: copy.composer.publish });

    expect((postBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('0 / 500')).toBeDefined();

    fireEvent.change(textarea, { target: { value: 'Too short!' } });
    expect((postBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('10 / 500')).toBeDefined();

    fireEvent.change(textarea, {
      target: { value: 'This is a valid claim meeting the twenty character length requirement.' },
    });
    expect((postBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the low-tier hold warning for low-tier members', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      authValue({ ...neutralUser, score: { q: '-2.000', sigma: '0.500', tier: 'low' } }),
    );
    renderWithProviders(<Composer />, { withAuth: false });
    expect(screen.getByText(copy.composer.lowTierWarning)).toBeDefined();
  });
});
