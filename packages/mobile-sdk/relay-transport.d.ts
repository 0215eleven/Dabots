/** Relay pairing material shown by the computer (pairing code `v: 2`). */
export interface RelayHost {
  relay: string;
  computerId: string;
  computerKey: string;
  serverId: string;
}
export type RelayStatus = 'connecting' | 'ready' | 'offline' | 'disconnected';
export interface RelayTransport {
  /** Synthetic HTTPS origin the client addresses; requests never leave through it. */
  readonly baseUrl: string;
  /** Identity of the computer's relay key, stored like a TLS pin. */
  readonly tlsPin: string;
  readonly fetch: typeof fetch;
  readonly WebSocket: typeof WebSocket;
  readonly connected: boolean;
  dispose(): void;
}
export function createRelayTransport(options: RelayHost & {
  randomBytes: (length: number) => Uint8Array;
  WebSocket?: typeof WebSocket;
  onStatus?: (status: RelayStatus) => void;
}): RelayTransport;
