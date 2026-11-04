/**
 * TASK-006 test: App renders without crashing and names the product.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { copy } from './copy';

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
  it('renders the shell with the product wordmark and primary navigation', () => {
    renderApp();
    expect(screen.getAllByText(copy.app.shortName).length).toBeGreaterThan(0);
    expect(screen.getAllByText(copy.app.nav.home).length).toBeGreaterThan(0);
  });
});
