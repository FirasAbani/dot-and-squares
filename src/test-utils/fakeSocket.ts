/**
 * The smallest WebSocket stand-in that will drive the lobby and room hooks in
 * jsdom, which has no WebSocket of its own.
 *
 * Deliberately outside the `src/**\/*.test.ts` include, so it is a helper and
 * never collected as a suite. Install it per-suite with `vi.stubGlobal` — NOT
 * in `src/test-setup.ts`, where replacing the global would quietly reach every
 * existing test.
 */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }

  /** Test drivers below — not part of the DOM interface. */
  accept(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  emit(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }

  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!socket) throw new Error('no socket was opened');
    return socket;
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
}
