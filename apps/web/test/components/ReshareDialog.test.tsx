import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReshareDialog } from '../../src/components/posts/ReshareDialog';
import { Post } from '../../src/types';
import { copy } from '../../src/copy';

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
  it('displays confirmation warning prompt when requiresShareConfirmation is true', () => {
    render(
      <ReshareDialog
        post={basePost}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText(copy.reshareDialog.warningPrompt)).toBeDefined();
    expect(screen.getAllByText(copy.reshareDialog.title).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(basePost.body)).toBeDefined();
  });

  it('does not display warning prompt when requiresShareConfirmation is false', () => {
    const safePost: Post = {
      ...basePost,
      requiresShareConfirmation: false,
      label: 'fact_checked_true',
    };

    render(
      <ReshareDialog
        post={safePost}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByText(copy.reshareDialog.warningPrompt)).toBeNull();
  });

  it('submits onConfirm callback with optional comment', async () => {
    const onConfirmMock = vi.fn().mockResolvedValue(undefined);
    const onCloseMock = vi.fn();

    render(
      <ReshareDialog
        post={basePost}
        isOpen={true}
        onClose={onCloseMock}
        onConfirm={onConfirmMock}
      />
    );

    const textarea = screen.getByPlaceholderText(copy.reshareDialog.commentPlaceholder);
    fireEvent.change(textarea, { target: { value: 'Important context on this post' } });

    const submitBtn = screen.getByRole('button', { name: copy.reshareDialog.confirmShare });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onConfirmMock).toHaveBeenCalledWith('Important context on this post');
      expect(onCloseMock).toHaveBeenCalled();
    });
  });
});
