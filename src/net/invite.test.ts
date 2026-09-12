/**
 * Inviting someone who is not here.
 *
 * The friend has never opened this site, so nothing installed in a browser can
 * reach them — not a notification, not web push, both of which can only wake a
 * device that already visited and agreed. Their phone's own share sheet can,
 * so that is the path this takes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteText, offerInvite } from './invite';

const ORIGIN = 'https://dots-and-squares.example';

function withShare(impl: (data: ShareData) => Promise<void>) {
  const share = vi.fn(impl);
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  return share;
}

function withClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('offering an invitation', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { origin: ORIGIN },
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share');
    vi.restoreAllMocks();
  });

  it('uses the device share sheet when there is one', async () => {
    const share = withShare(async () => {});
    withClipboard();

    expect(await offerInvite('ABC234', 'Ada')).toBe('shared');
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${ORIGIN}/?room=ABC234` }),
    );
  });

  it('names the host, so the message means something on a lock screen', async () => {
    const share = withShare(async () => {});
    withClipboard();
    await offerInvite('ABC234', 'Ada');

    expect(share.mock.calls[0][0].text).toBe('Ada wants to play Dots & Squares with you');
  });

  /**
   * Opening the sheet and changing your mind is not a failure, and must not be
   * reported as one. The share API raises AbortError for it.
   */
  it('treats a dismissed share sheet as neither success nor error', async () => {
    withShare(async () => {
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    });
    const writeText = withClipboard();

    expect(await offerInvite('ABC234', 'Ada')).toBe('dismissed');
    // And it must NOT quietly copy instead — that would put a link on the
    // clipboard of someone who just said no.
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard where there is no share sheet', async () => {
    const writeText = withClipboard();

    expect(await offerInvite('ABC234', 'Ada')).toBe('copied');
    expect(writeText.mock.calls[0][0]).toContain(`${ORIGIN}/?room=ABC234`);
  });

  /** A sheet that exists but fails still leaves the clipboard worth trying. */
  it('falls back to the clipboard when the share sheet errors', async () => {
    withShare(async () => {
      throw new Error('not allowed');
    });
    const writeText = withClipboard();

    expect(await offerInvite('ABC234', 'Ada')).toBe('copied');
    expect(writeText).toHaveBeenCalled();
  });

  it('reports failure when neither is available, rather than pretending', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('blocked');
        },
      },
      configurable: true,
    });

    expect(await offerInvite('ABC234', 'Ada')).toBe('failed');
  });

  it('still reads as an invitation when the host has no name yet', () => {
    expect(inviteText(null)).toBe('Come and play Dots & Squares with me');
  });
});
