export const PROTOCOL_VERSION = 1;

/** 담배 끄기: 벽에 지지기 / 변기에 버리기 / 바닥에 버리고 비비기 */
export type SnuffAction = 'snuff_wall' | 'snuff_toilet' | 'snuff_floor';
export const SNUFF_ACTIONS: readonly SnuffAction[] = ['snuff_wall', 'snuff_toilet', 'snuff_floor'];

/**
 * 담배: 담배갑에서 꺼내기 → 불 붙이기 → 흡입 → 내뿜기.
 * 재 털기·끄기는 불이 붙어 있는 동안 언제든 할 수 있다.
 */
export type SmokeAction = 'take' | 'light' | 'puff' | 'exhale' | 'ash' | SnuffAction;
export const SMOKE_ACTIONS: readonly SmokeAction[] = ['take', 'light', 'puff', 'exhale', 'ash', ...SNUFF_ACTIONS];

export type ActionType = 'fart' | 'poop' | 'flush' | 'bidet' | 'knock' | 'spit' | 'phlegm' | 'wipe' | SmokeAction;
export const ACTIONS: readonly ActionType[] = [
  'fart',
  'poop',
  'flush',
  'bidet',
  'knock',
  'spit',
  'phlegm',
  'wipe',
  ...SMOKE_ACTIONS,
];

/**
 * sound.play로 알리는 일. 사용자가 요청하는 액션에 더해, 서버가 스스로 일으키는 일이 있다.
 * - burnout: 담배를 끄지 않아 필터까지 다 타서 손가락을 데었다 ("아뜨뜨")
 */
export type SoundAction = ActionType | 'burnout';

/**
 * 같은 액션이라도 서버가 확률로 정하는 변주. 모두에게 같은 장면이 보이도록 서버가 고른다.
 * - cough: 흡입하다 사레들려 기침한다
 * - ring: 내뿜은 연기가 도넛 모양이 된다
 */
export type SoundVariant = 'cough' | 'ring';

export const DEFAULT_CONFIG = {
  nameMaxLength: 12,
  heartbeatIntervalMs: 10_000,
  heartbeatTimeoutMs: 30_000,
  gracePeriodMs: 30_000,
  priorityWindowMs: 10_000,
  chatMaxLength: 60,
  chatCooldownMs: 1_000,
  cooldownsMs: {
    fart: 3_000,
    poop: 4_000,
    flush: 5_000,
    bidet: 4_000,
    knock: 3_000,
    spit: 2_000,
    phlegm: 4_000,
    wipe: 3_000,
    take: 2_000,
    light: 3_000,
    puff: 1_500,
    exhale: 1_500,
    ash: 2_000,
    snuff_wall: 2_000,
    snuff_toilet: 2_000,
    snuff_floor: 2_000,
  } as Record<ActionType, number>,
  /** 불 붙인 담배가 그냥 두어도 필터까지 다 타는 데 걸리는 시간 */
  cigaretteBurnMs: 120_000,
  /** 한 모금 빨 때마다 이만큼 더 탄다 */
  cigarettePuffBurnMs: 8_000,
  /** 흡입하다 기침할 확률 */
  coughChance: 0.25,
  /** 내뿜은 연기가 도넛 모양이 될 확률 */
  smokeRingChance: 0.35,
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
  | 'NO_CIGARETTE'
  | 'ALREADY_HAS_CIGARETTE'
  | 'CIGARETTE_LIT'
  | 'CIGARETTE_NOT_LIT'
  | 'NOT_INHALED'
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

/** 부스 사용자가 손에 든 담배. 부스를 나가면 사라진다. */
export interface Cigarette {
  /** 불을 붙인 시각. 꺼내기만 했으면 null */
  litAt: number | null;
  /** 지금까지 빤 횟수. 한 모금마다 cigarettePuffBurnMs만큼 더 탄다 */
  puffs: number;
  /** 흡입한 뒤 아직 내뿜지 않았는지 */
  inhaling: boolean;
  /** 마지막으로 재를 털었을 때까지 탄 양(ms). 지금 탄 양과의 차이만큼 재가 매달려 있다 */
  ashClearedAt: number;
}

/** 지금까지 탄 양(ms). 불을 붙이지 않았으면 0이고, cigaretteBurnMs에 닿으면 다 탄 것이다. */
export function cigaretteBurnedMs(cigarette: Cigarette, now: number, config: Pick<Config, 'cigarettePuffBurnMs'>): number {
  if (cigarette.litAt === null) return 0;
  return Math.max(0, now - cigarette.litAt) + cigarette.puffs * config.cigarettePuffBurnMs;
}

export interface Snapshot {
  serverInstanceId: string;
  revision: number;
  participants: Participant[];
  booth: { occupantId: string | null; occupiedSince: number | null; cigarette: Cigarette | null };
  queue: string[];
  priority: { userId: string; expiresAt: number } | null;
  self: { userId: string; cooldownUntil: Record<ActionType, number> };
}

// ---- client -> server ----
export type ClientMessage =
  | { type: 'session.open'; requestId: string; payload: { name: string } | { sessionToken: string } }
  | { type: 'state.sync'; requestId: string; payload: Record<string, never> }
  /** 로비로 나가기: 세션을 바로 끝내고 자리를 비운다 */
  | { type: 'session.close'; requestId: string; payload: Record<string, never> }
  | { type: 'booth.enter'; requestId: string; payload: Record<string, never> }
  | { type: 'booth.leave'; requestId: string; payload: Record<string, never> }
  | { type: 'queue.join'; requestId: string; payload: Record<string, never> }
  | { type: 'queue.cancel'; requestId: string; payload: Record<string, never> }
  | { type: 'action.perform'; requestId: string; payload: { action: ActionType } }
  | { type: 'chat.send'; requestId: string; payload: { text: string } }
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
      payload: { eventId: string; actorId: string; action: SoundAction; occurredAt: number; variant?: SoundVariant };
    }
  | { type: 'chat.message'; payload: { messageId: string; userId: string; text: string; at: number } }
  | { type: 'heartbeat.ping'; payload: { nonce: string } }
  | { type: 'session.replaced'; payload: { code: 'SESSION_REPLACED'; message: string } };

export type ServerEnvelope = ServerMessage & { v: typeof PROTOCOL_VERSION; serverTime: number };

// 종료 코드
export const CLOSE_AUTH_TIMEOUT = 4001;
export const CLOSE_HEARTBEAT_TIMEOUT = 4002;
export const CLOSE_SESSION_REPLACED = 4009;
