/**
 * The white-page case: without this boundary a single render error anywhere in
 * the tree leaves the player with a blank tab, no explanation and no way out.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

/** Throws on its first render, then behaves — so recovery has something to reach. */
function Fragile({ throwNow }: { throwNow: boolean }) {
  if (throwNow) throw new Error('boom');
  return <p>the game</p>;
}

/** A child that can be told to break, the way a real bug would appear mid-play. */
function Breakable() {
  const [broken, setBroken] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setBroken(true)}>
        Break it
      </button>
      <Fragile throwNow={broken} />
    </>
  );
}

describe('a render error anywhere under the boundary', () => {
  beforeEach(() => {
    // React logs the caught error itself; the noise is not the thing under test.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a way out instead of a white page', async () => {
    render(
      <ErrorBoundary>
        <Fragile throwNow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/the game hit an error/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to Menu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('records the failure where a browser console will keep it', () => {
    render(
      <ErrorBoundary>
        <Fragile throwNow />
      </ErrorBoundary>,
    );

    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(logged.some((call) => String(call[0]).includes('Dots & Squares crashed'))).toBe(true);
  });

  /**
   * The boundary must rebuild the tree, not merely clear its own flag: state
   * that threw once throws again the moment it is re-rendered.
   */
  it('recovers to a working game rather than straight back into the error', async () => {
    render(
      <ErrorBoundary>
        <Breakable />
      </ErrorBoundary>,
    );
    expect(screen.getByText('the game')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Break it' }));
    expect(screen.getByRole('alert')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Back to Menu' }));

    // Remounted: the child is back in its initial, working state.
    expect(screen.getByText('the game')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays out of the way when nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <p>the game</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('the game')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
