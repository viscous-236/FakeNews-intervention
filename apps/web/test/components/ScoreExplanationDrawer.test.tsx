import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreExplanationDrawer } from '../../src/components/score/ScoreExplanationDrawer';
import { EventItem } from '../../src/types';
import { copy } from '../../src/copy';

const mockCountedEvents: EventItem[] = [
  {
    id: 'ev-1',
    kind: 'RESPONSIBLE_RESHARE',
    value: 1,
    status: 'counted',
    waveNumber: 3,
    voidReason: null,
    post: { id: 'p-1', excerpt: 'Verified climate report excerpt' },
    assessment: null,
    reversesEventId: null,
    appeal: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'ev-2',
    kind: 'MISINFO_LIKE',
    value: -1,
    status: 'counted',
    waveNumber: 3,
    voidReason: null,
    post: { id: 'p-2', excerpt: 'Debunked viral claim excerpt' },
    assessment: null,
    reversesEventId: null,
    appeal: null,
    createdAt: new Date().toISOString(),
  },
];

describe('ScoreExplanationDrawer', () => {
  it('renders Paper Equation 2 formula and arithmetic substitution with real numbers', () => {
    render(
      <ScoreExplanationDrawer
        isOpen={true}
        onClose={vi.fn()}
        waveNumber={3}
        qBefore="2.500"
        sigma="0.500"
        nPos={2}
        nNeg={1}
        nAdj={0}
        r={1}
        delta="0.500"
        qAfter="3.000"
        countedEvents={mockCountedEvents}
      />
    );

    // Header & formula
    expect(screen.getByText(/How Your Score is Calculated \(Wave #3\)/)).toBeDefined();
    expect(screen.getByText(copy.score.formulaDisplay)).toBeDefined();
    expect(screen.getByText(copy.score.formulaRDisplay)).toBeDefined();

    // Arithmetic lines
    expect(screen.getByText('+2')).toBeDefined();
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0);
    expect(screen.getByText('0.500 × 1 = 0.500')).toBeDefined();
    expect(screen.getByText('2.500 + (0.500) = 3.000')).toBeDefined();
  });

  it('renders all counted event kinds including RESPONSIBLE_RESHARE and MISINFO_LIKE', () => {
    render(
      <ScoreExplanationDrawer
        isOpen={true}
        onClose={vi.fn()}
        waveNumber={3}
        qBefore="2.500"
        sigma="0.500"
        nPos={1}
        nNeg={1}
        nAdj={0}
        r={0}
        delta="0.000"
        qAfter="2.500"
        countedEvents={mockCountedEvents}
      />
    );

    // Event kind labels from copy.ts
    expect(screen.getByText(copy.eventKind.RESPONSIBLE_RESHARE)).toBeDefined();
    expect(screen.getByText(copy.eventKind.MISINFO_LIKE)).toBeDefined();
    expect(screen.getByText('"Verified climate report excerpt"')).toBeDefined();
    expect(screen.getByText('"Debunked viral claim excerpt"')).toBeDefined();
  });
});
