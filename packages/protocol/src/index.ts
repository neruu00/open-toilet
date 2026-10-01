export const PROTOCOL_VERSION = 1;

export type ActionType = 'fart' | 'flush' | 'knock';
export const ACTIONS: readonly ActionType[] = ['fart', 'flush', 'knock'];

export const DEFAULT_CONFIG = {
  nameMaxLength: 12,
  heartbeatIntervalMs: 10_000,
  heartbeatTimeoutMs: 30_000,
  gracePeriodMs: 30_000,
  priorityWindowMs: 10_000,
  cooldownsMs: { fart: 3_000, flush: 5_000, knock: 3_000 } as Record<ActionType, number>,
};
export type Config = typeof DEFAULT_CONFIG;

export type ErrorCode =
  | 'NAME_INVALID'
  | 'SESSION_INVALID'
  | 'SESSION_REQUIRED'
  | 'SESSION_ALREADY_OPEN'
  | 'SESSION_REPLACED'
  | 'BOOTH_OCCUPIED'
  | 'ALREADY_IN_BOOTH'
  | 'BOOTH_RESERVED'
  | 'BOOTH_EMPTY'
  | 'NOT_IN_BOOTH'
  | 'ALREADY_IN_QUEUE'
  | 'NOT_IN_QUEUE'
  | 'NOT_QUEUE_HEAD'
  | 'COOLDOWN'
  | 'DUPLICATE_REQUEST'
  | 'BAD_REQUEST'
  | 'UNKNOWN_EVENT'
  | 'UNSUPPORTED_VERSION'
  | 'AUTH_TIMEOUT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type ConnectionStatus = 'connected' | 'disconnected';

export interface Participant {
  userId: string;
  name: string;
  status: ConnectionStatus;
  graceExpiresAt: number | null;
}

export interface Snapshot {
  serverInstanceId: string;
  revision: number;
  participants: Participant[];
  booth: { occupantId: string | null; occupiedSince: number | null };
  queue: string[];
  priority: { userId: string; expiresAt: number } | null;
  self: { userId: string; cooldownUntil: Record<ActionType, number> };
}

// ---- client -> server ----
export type ClientMessage =
  | { type: 'session.open'; requestId: string; payload: { name: string } | { sessionToken: string } }
  | { type: 'state.sync'; requestId: string; payload: Record<string, never> }
  | { type: 'booth.enter'; requestId: string; payload: Record<string, never> }
  | { type: 'booth.leave'; requestId: string; payload: Record<string, never> }
  | { type: 'queue.join'; requestId: string; payload: Record<string, never> }
  | { type: 'queue.cancel'; requestId: string; payload: Record<string, never> }
  | { type: 'action.perform'; requestId: string; payload: { action: ActionType } }
  | { type: 'heartbeat.pong'; payload: { nonce: string } };

export type ClientEnvelope = ClientMessage & { v: typeof PROTOCOL_VERSION };

// ---- server -> client ----
export interface SessionReadyPayload {
  userId: string;
  sessionToken: string;
  resumed: boolean;
  serverInstanceId: string;
  config: Config;
}

export type ServerMessage =
  | { type: 'session.ready'; requestId?: string; payload: SessionReadyPayload }
  | { type: 'state.snapshot'; requestId?: string; payload: Snapshot }
  | {
      type: 'request.ok';
      requestId?: string;
      payload: { operation: string; revision: number; cooldownUntil?: Partial<Record<ActionType, number>> };
    }
  | {
      type: 'request.error';
      requestId?: string;
      payload: { code: ErrorCode; message: string; retryAfterMs?: number; cooldownUntil?: number };
    }
  | {
      type: 'sound.play';
      payload: { eventId: string; actorId: string; action: ActionType; occurredAt: number };
    }
  | { type: 'heartbeat.ping'; payload: { nonce: string } }
  | { type: 'session.replaced'; payload: { code: 'SESSION_REPLACED'; message: string } };

export type ServerEnvelope = ServerMessage & { v: typeof PROTOCOL_VERSION; serverTime: number };

// 종료 코드
export const CLOSE_AUTH_TIMEOUT = 4001;
export const CLOSE_HEARTBEAT_TIMEOUT = 4002;
export const CLOSE_SESSION_REPLACED = 4009;
