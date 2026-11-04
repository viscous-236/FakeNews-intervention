import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { PostCard } from '../../src/components/posts/PostCard';
import type { Post } from '../../src/types';
import { copy } from '../../src/copy';
import { renderWithProviders } from '../helpers';

const mockPost: Post = {
  id: 'post-123',
  kind: 'original',
  author: {
    id: 'user-1',
    username: 'alice',
    displayName: 'Alice Walker',
    avatarUrl: null,
    tier: 'trusted',
  },
  body: 'This is a sample verified investigative article reporting on energy markets.',
  sourceUrl: 'https://example.com/energy-report',
  images: [],
  status: 'published',
  createdAt: new Date().toISOString(),
  editedAt: null,
  label: 'fact_checked_true',
  underAppeal: false,
  requiresShareConfirmation: false,
  counts: { likes: 12, comments: 4, reshares: 7 },
  viewer: { liked: false, reshared: false },
  reshareOf: null,
};

describe('PostCard', () => {
  it('renders author, tier badge, verified label, body and source host', () => {
    renderWithProviders(<PostCard post={mockPost} />);
    expect(screen.getByText('Alice Walker')).toBeDefined();
    expect(screen.getByText('@alice')).toBeDefined();
    expect(screen.getByText(copy.tier.trusted)).toBeDefined();
    expect(screen.getByText(copy.postLabel.fact_checked_true)).toBeDefined();
    expect(screen.getByText(mockPost.body)).toBeDefined();
    expect(screen.getByText(`${copy.post.source}: example.com`)).toBeDefined();
  });

  it('renders the false label and the under-appeal chip', () => {
    renderWithProviders(
      <PostCard
        post={{
          ...mockPost,
          id: 'post-456',
          label: 'fact_checked_false',
          underAppeal: true,
          requiresShareConfirmation: true,
        }}
      />,
    );
    expect(screen.getByText(copy.postLabel.fact_checked_false)).toBeDefined();
    expect(screen.getByText(copy.post.underAppeal)).toBeDefined();
  });

  it('renders the automated-check label when auto_flagged', () => {
    renderWithProviders(<PostCard post={{ ...mockPost, id: 'post-789', label: 'auto_flagged' }} />);
    expect(screen.getByText(copy.postLabel.auto_flagged)).toBeDefined();
  });

  it('shows like, share and comment counts', () => {
    renderWithProviders(<PostCard post={mockPost} />);
    expect(screen.getByText('12')).toBeDefined();
    expect(screen.getByText('7')).toBeDefined();
    expect(screen.getByText('4')).toBeDefined();
  });

  it('renders a reshare with its original post embedded and attribution', () => {
    const reshare: Post = {
      ...mockPost,
      id: 'reshare-1',
      kind: 'reshare',
      author: {
        id: 'user-2',
        username: 'bob',
        displayName: 'Bob Builder',
        avatarUrl: null,
        tier: 'neutral',
      },
      body: 'Worth a read.',
      sourceUrl: null,
      reshareOf: mockPost,
    };
    renderWithProviders(<PostCard post={reshare} />);
    expect(screen.getByText(copy.post.resharedBy('Bob Builder'))).toBeDefined();
    expect(screen.getByText('Worth a read.')).toBeDefined();
    expect(screen.getByText(mockPost.body)).toBeDefined();
  });
});
