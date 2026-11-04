import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostCard } from '../../src/components/posts/PostCard';
import { Post } from '../../src/types';
import { copy } from '../../src/copy';
import { AuthProvider } from '../../src/context/AuthContext';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>{ui}</AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

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
  counts: {
    likes: 12,
    comments: 4,
    reshares: 7,
  },
  viewer: {
    liked: false,
    reshared: false,
  },
  reshareOf: null,
};

describe('PostCard', () => {
  it('renders author info, tier badge, and verified label', () => {
    renderWithProviders(<PostCard post={mockPost} />);

    expect(screen.getByText('Alice Walker')).toBeDefined();
    expect(screen.getByText('@alice')).toBeDefined();
    expect(screen.getByText(copy.tier.trusted)).toBeDefined();
    expect(screen.getByText(copy.postLabel.fact_checked_true)).toBeDefined();
    expect(screen.getByText(mockPost.body)).toBeDefined();
    expect(screen.getByText('https://example.com/energy-report')).toBeDefined();
  });

  it('renders false label badge and under appeal flag when applicable', () => {
    const falsePost: Post = {
      ...mockPost,
      id: 'post-456',
      label: 'fact_checked_false',
      underAppeal: true,
      requiresShareConfirmation: true,
    };

    renderWithProviders(<PostCard post={falsePost} />);

    expect(screen.getByText(copy.postLabel.fact_checked_false)).toBeDefined();
    expect(screen.getByText(copy.post.underAppeal)).toBeDefined();
  });

  it('renders automated check badge when auto_flagged', () => {
    const flaggedPost: Post = {
      ...mockPost,
      id: 'post-789',
      label: 'auto_flagged',
    };

    renderWithProviders(<PostCard post={flaggedPost} />);
    expect(screen.getByText(copy.postLabel.auto_flagged)).toBeDefined();
  });

  it('displays counts for likes, reshares, and comments', () => {
    renderWithProviders(<PostCard post={mockPost} />);

    expect(screen.getByText('12')).toBeDefined();
    expect(screen.getByText('7')).toBeDefined();
    expect(screen.getByText('4')).toBeDefined();
  });
});
