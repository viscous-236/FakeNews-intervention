import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { ReshareDialog } from '../../src/components/posts/ReshareDialog';
import type { Post } from '../../src/types';
import { copy } from '../../src/copy';
import { renderWithProviders } from '../helpers';

const basePost: Post = {
  id: 'post-101',
  kind: 'original',
  author: {
    id: 'u-1',
    username: 'bob',
    displayName: 'Bob Builder',
    avatarUrl: null,
    tier: 'neutral',
  },
  body: 'This is a controversial statement subject to potential penalty if false.',
  sourceUrl: null,
  images: [],
  status: 'published',
  createdAt: new Date().toISOString(),
  editedAt: null,
  label: 'auto_flagged',
  underAppeal: false,
  requiresShareConfirmation: true,
  counts: { likes: 0, comments: 0, reshares: 0 },
  viewer: { liked: false, reshared: false },
  reshareOf: null,
};

describe('ReshareDialog', () => {
  it('shows the warning and requires acknowledgement when confirmation is required', () => {
    renderWithProviders(
      <ReshareDialog
        post={basePost}
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
      { withAuth: false },
    );
    expect(screen.getByText(copy.reshareDialog.warningPrompt)).toBeDefined();
    expect(screen.getByText(basePost.body)).toBeDefined();
    const submit = screen.getByRole('button', {
      name: copy.reshareDialog.confirmShare,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(copy.reshareDialog.acknowledge));
    expect(submit.disabled).toBe(false);
  });

  it('does not show the warning when confirmation is not required', () => {
    renderWithProviders(
      <ReshareDialog
        post={{ ...basePost, requiresShareConfirmation: false, label: 'fact_checked_true' }}
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
      { withAuth: false },
    );
    expect(screen.queryByText(copy.reshareDialog.warningPrompt)).toBeNull();
  });

  it('submits the comment and acknowledgedWarning = true, then closes', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderWithProviders(
      <ReshareDialog post={basePost} isOpen onClose={onClose} onConfirm={onConfirm} />,
      { withAuth: false },
    );

    fireEvent.click(screen.getByLabelText(copy.reshareDialog.acknowledge));
    fireEvent.change(screen.getByPlaceholderText(copy.reshareDialog.commentPlaceholder), {
      target: { value: 'Important context on this post' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.reshareDialog.confirmShare }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('Important context on this post', true);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
