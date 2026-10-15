/**
 * TASK-006 test: App renders without crashing.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

function renderApp(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('renders the platform heading', () => {
    renderApp();
    expect(screen.getByText('FakeNews Intervention Platform')).toBeDefined();
  });
});
