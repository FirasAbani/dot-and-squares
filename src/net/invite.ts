import { shareLink } from './roomCode';

/**
 * Handing a game to someone who is not here.
 *
 * The friend being invited has never opened this site, so nothing we could
 * install in a browser can reach them. Their phone already has an app that
 * can, and they already trust it — so the invitation leaves through the
 * device's own share sheet and arrives as a normal message.
 *
 * That is also why this is not web push. Push can only wake a device that has
 * already visited and granted permission, which is exactly the person who does
 * not need inviting.
 */

/** What the invitation says. Short: most of these arrive on a lock screen. */
export function inviteText(hostName?: string | null): string {
  return hostName
    ? `${hostName} wants to play Dots & Squares with you`
    : 'Come and play Dots & Squares with me';
}

export type InviteOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

/** The text and link, for a caller that has to offer them by hand. */
export function inviteMessage(code: string, hostName?: string | null): string {
  return `${inviteText(hostName)}\n${shareLink(code)}`;
}

/**
 * Offers the invitation through the device share sheet, falling back to the
 * clipboard where there is none (most desktop browsers).
 *
 * `dismissed` is a success as far as anything here is concerned — the player
 * opened the sheet and changed their mind, which must not be reported as an
 * error. The share API reports that as an `AbortError`.
 */
export async function offerInvite(
  code: string,
  hostName?: string | null,
): Promise<InviteOutcome> {
  const url = shareLink(code);
  const text = inviteText(hostName);

  // Desktop browsers have no share sheet at all, which is the common case and
  // not a failure. The clipboard is the useful path there: the host is about to
  // paste this into a chat, not read it out to someone in the room.
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Dots & Squares', text, url });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'dismissed';
      // A share sheet that exists but refuses still leaves the clipboard, so
      // fall through rather than telling the player it cannot be done.
    }
  }

  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return 'copied';
  } catch {
    // Both refused. The caller must then show the link itself — telling the
    // player to "read out the code" blames the share sheet for something the
    // clipboard failed at, and is useless advice for inviting someone who is
    // not in the room with you.
    return 'failed';
  }
}
