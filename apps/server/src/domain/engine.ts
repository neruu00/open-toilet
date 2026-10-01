import { randomBytes, randomUUID } from 'node:crypto';
import {
  ACTIONS,
  CLOSE_AUTH_TIMEOUT,
  CLOSE_HEARTBEAT_TIMEOUT,
  CLOSE_SESSION_REPLACED,
  DEFAULT_CONFIG,
  PROTOCOL_VERSION,
  type ActionType,
  type Config,
  type ErrorCode,
  type ServerEnvelope,
  type ServerMessage,
  type Snapshot,
} from '@open-toilet/protocol';

export interface Outbox {
  send(connectionId: string, message: ServerEnvelope): void;
  close(connectionId: string, code: number, reason: string): void;
}

export interface EngineOptions {
  now: () => number;
  out: Outbox;
  config?: Partial<Config>;
}

interface Session {
  userId: string;
  name: string;
  token: string;
  connId: string | null;
  status: 'connected' | 'disconnected';
  graceExpiresAt: number | null;
  cooldownUntil: Record<ActionType, number>;
}

interface Conn {
  id: string;
  connectedAt: number;
  userId: string | null;
  lastPongAt: number;
  lastPingAt: number;
  pendingNonces: Set<string>;
  seenRequestIds: Map<string, number>;
  recentRequestTimes: number[];
}

const AUTH_TIMEOUT_MS = 5_000;
const REQUEST_ID_TTL_MS = 60_000;
const REQUEST_ID_MAX = 256;
const RATE_LIMIT_PER_SEC = 20;
const MAX_NONCES = 5;

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  NAME_INVALID: '이름은 공백 제외 1~12자로 입력해 주세요.',
  SESSION_INVALID: '세션이 만료되었습니다. 이름을 다시 입력해 주세요.',
  SESSION_REQUIRED: '먼저 이름을 설정해 주세요.',
  SESSION_ALREADY_OPEN: '이미 접속 중입니다.',
  SESSION_REPLACED: '다른 탭에서 연결했습니다.',
  BOOTH_OCCUPIED: '이미 누군가 사용 중입니다.',
  ALREADY_IN_BOOTH: '이미 부스 안에 있습니다.',
  BOOTH_RESERVED: '다른 분의 우선 입장 시간입니다.',
  BOOTH_EMPTY: '부스가 비어 있습니다.',
  NOT_IN_BOOTH: '부스 안에 있는 사람만 할 수 있어요.',
  ALREADY_IN_QUEUE: '이미 줄을 서 있습니다.',
  NOT_IN_QUEUE: '줄을 서 있지 않습니다.',
  NOT_QUEUE_HEAD: '줄 맨 앞 사람만 문을 두드릴 수 있어요.',
  COOLDOWN: '잠시 후 다시 시도해 주세요.',
  DUPLICATE_REQUEST: '중복된 요청입니다.',
  BAD_REQUEST: '잘못된 요청입니다.',
  UNKNOWN_EVENT: '지원하지 않는 요청입니다.',
  UNSUPPORTED_VERSION: '버전이 맞지 않습니다. 새로고침해 주세요.',
  AUTH_TIMEOUT: '인증 시간이 초과되었습니다.',
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  INTERNAL_ERROR: '서버 오류가 발생했습니다.',
};

export function normalizeName(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').trim();
  const length = [...name].length;
  if (length < 1 || length > maxLength) return null;
  if (/\p{Cc}/u.test(name)) return null;
  // 공백/제로폭 문자만으로 구성된 이름 거절
  if (!/[^\s\p{Cf}]/u.test(name)) return null;
  return name;
}

export class Engine {
  readonly config: Config;
  readonly serverInstanceId = `srv_${randomBytes(4).toString('hex')}`;

  private readonly now: () => number;
  private readonly out: Outbox;

  private conns = new Map<string, Conn>();
  private sessions = new Map<string, Session>();
  private tokens = new Map<string, string>(); // token -> userId
  private occupantId: string | null = null;
  private occupiedSince: number | null = null;
  private queue: string[] = [];
  private priority: { userId: string; expiresAt: number } | null = null;
  private revision = 0;

  constructor(options: EngineOptions) {
    this.now = options.now;
    this.out = options.out;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  // ---------- 외부 진입점 ----------

  connect(connId: string): void {
    const now = this.now();
    this.conns.set(connId, {
      id: connId,
      connectedAt: now,
      userId: null,
      lastPongAt: now,
      lastPingAt: now,
      pendingNonces: new Set(),
      seenRequestIds: new Map(),
      recentRequestTimes: [],
    });
  }

  close(connId: string): void {
    const conn = this.conns.get(connId);
    if (!conn) return;
    this.conns.delete(connId);
    this.detachSession(conn);
  }

  message(connId: string, raw: string): void {
    const conn = this.conns.get(connId);
    if (!conn) return;
    this.tick();
    if (!this.conns.has(connId)) return;

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      this.sendError(conn, undefined, 'BAD_REQUEST');
      return;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      this.sendError(conn, undefined, 'BAD_REQUEST');
      return;
    }
    const msg = data as Record<string, unknown>;
    const requestId = typeof msg.requestId === 'string' && msg.requestId.length <= 64 ? msg.requestId : undefined;

    if (msg.v !== PROTOCOL_VERSION) {
      this.sendError(conn, requestId, 'UNSUPPORTED_VERSION');
      this.out.close(conn.id, 1002, 'unsupported version');
      this.close(conn.id);
      return;
    }
    if (typeof msg.type !== 'string') {
      this.sendError(conn, requestId, 'BAD_REQUEST');
      return;
    }
    const payload =
      typeof msg.payload === 'object' && msg.payload !== null && !Array.isArray(msg.payload)
        ? (msg.payload as Record<string, unknown>)
        : null;

    if (msg.type === 'heartbeat.pong') {
      this.handlePong(conn, payload?.nonce);
      return;
    }

    const now = this.now();
    conn.recentRequestTimes = conn.recentRequestTimes.filter((t) => now - t < 1000);
    conn.recentRequestTimes.push(now);
    if (conn.recentRequestTimes.length > RATE_LIMIT_PER_SEC) {
      this.sendError(conn, requestId, 'RATE_LIMITED', { retryAfterMs: 1000 });
      return;
    }

    if (!requestId || !payload) {
      this.sendError(conn, requestId, 'BAD_REQUEST');
      return;
    }
    if (conn.seenRequestIds.has(requestId)) {
      this.sendError(conn, requestId, 'DUPLICATE_REQUEST');
      return;
    }
    this.rememberRequestId(conn, requestId, now);

    try {
      this.dispatch(conn, msg.type, requestId, payload);
    } catch (error) {
      console.error('[engine] unexpected error', error);
      this.sendError(conn, requestId, 'INTERNAL_ERROR');
    }
  }

  /** 주기적으로 호출(약 250ms). 기한 만료, 하트비트, 인증 타임아웃을 처리한다. */
  tick(): void {
    const now = this.now();
    let changed = false;

    for (const conn of [...this.conns.values()]) {
      if (!conn.userId) {
        if (now - conn.connectedAt >= AUTH_TIMEOUT_MS) {
          this.sendError(conn, undefined, 'AUTH_TIMEOUT');
          this.out.close(conn.id, CLOSE_AUTH_TIMEOUT, 'auth timeout');
          this.conns.delete(conn.id);
        }
        continue;
      }
      if (now - conn.lastPongAt >= this.config.heartbeatTimeoutMs) {
        this.out.close(conn.id, CLOSE_HEARTBEAT_TIMEOUT, 'heartbeat timeout');
        this.conns.delete(conn.id);
        if (this.detachSession(conn)) changed = true;
        continue;
      }
      if (now - conn.lastPingAt >= this.config.heartbeatIntervalMs) {
        conn.lastPingAt = now;
        const nonce = `hb-${randomBytes(6).toString('hex')}`;
        conn.pendingNonces.add(nonce);
        if (conn.pendingNonces.size > MAX_NONCES) {
          const oldest = conn.pendingNonces.values().next().value;
          if (oldest !== undefined) conn.pendingNonces.delete(oldest);
        }
        this.send(conn.id, { type: 'heartbeat.ping', payload: { nonce } });
      }
    }

    // 유예 만료 먼저 처리 → 이후 입장권 재조정
    for (const session of [...this.sessions.values()]) {
      if (session.status === 'disconnected' && session.graceExpiresAt !== null && now >= session.graceExpiresAt) {
        this.removeSession(session);
        changed = true;
      }
    }

    if (this.priority && now >= this.priority.expiresAt) {
      this.removeFromQueue(this.priority.userId);
      this.priority = null;
      changed = true;
    }

    if (this.reconcilePriority()) changed = true;
    if (changed) this.commit();
  }

  // ---------- 디스패치 ----------

  private dispatch(conn: Conn, type: string, requestId: string, payload: Record<string, unknown>): void {
    if (type === 'session.open') {
      if (conn.userId) return this.sendError(conn, requestId, 'SESSION_ALREADY_OPEN');
      return this.openSession(conn, requestId, payload);
    }
    const session = conn.userId ? this.sessions.get(conn.userId) : undefined;
    if (!session || session.connId !== conn.id) return this.sendError(conn, requestId, 'SESSION_REQUIRED');

    switch (type) {
      case 'state.sync':
        this.send(conn.id, { type: 'state.snapshot', requestId, payload: this.snapshotFor(session) });
        return;
      case 'booth.enter':
        return this.enterBooth(conn, session, requestId);
      case 'booth.leave':
        return this.leaveBooth(conn, session, requestId);
      case 'queue.join':
        return this.joinQueue(conn, session, requestId);
      case 'queue.cancel':
        return this.cancelQueue(conn, session, requestId);
      case 'action.perform':
        return this.performAction(conn, session, requestId, payload.action);
      default:
        return this.sendError(conn, requestId, 'UNKNOWN_EVENT');
    }
  }

  // ---------- 세션 ----------

  private openSession(conn: Conn, requestId: string, payload: Record<string, unknown>): void {
    const hasName = 'name' in payload;
    const hasToken = 'sessionToken' in payload;
    if (hasName === hasToken) return this.sendError(conn, requestId, 'BAD_REQUEST');

    if (hasToken) {
      const token = payload.sessionToken;
      const userId = typeof token === 'string' ? this.tokens.get(token) : undefined;
      const session = userId ? this.sessions.get(userId) : undefined;
      if (!session) return this.sendError(conn, requestId, 'SESSION_INVALID');
      this.resumeSession(conn, session, requestId);
      return;
    }

    const name = normalizeName(payload.name, this.config.nameMaxLength);
    if (name === null) return this.sendError(conn, requestId, 'NAME_INVALID');

    const session: Session = {
      userId: `u_${randomUUID().slice(0, 8)}`,
      name,
      token: randomBytes(32).toString('base64url'),
      connId: conn.id,
      status: 'connected',
      graceExpiresAt: null,
      cooldownUntil: { fart: 0, flush: 0, knock: 0 },
    };
    this.sessions.set(session.userId, session);
    this.tokens.set(session.token, session.userId);
    this.attach(conn, session);
    this.sendReady(conn, session, requestId, false);
    this.reconcilePriority();
    this.commit();
  }

  private resumeSession(conn: Conn, session: Session, requestId: string): void {
    const previousConnId = session.connId;
    const wasDisconnected = session.status === 'disconnected';
    if (previousConnId && previousConnId !== conn.id) {
      const previous = this.conns.get(previousConnId);
      if (previous) {
        this.send(previous.id, {
          type: 'session.replaced',
          payload: { code: 'SESSION_REPLACED', message: ERROR_MESSAGES.SESSION_REPLACED },
        });
        this.out.close(previous.id, CLOSE_SESSION_REPLACED, 'session replaced');
        previous.userId = null;
        this.conns.delete(previous.id);
      }
    }
    session.connId = conn.id;
    session.status = 'connected';
    session.graceExpiresAt = null;
    this.attach(conn, session);
    this.sendReady(conn, session, requestId, true);

    if (wasDisconnected) {
      this.reconcilePriority();
      this.commit();
    } else {
      this.send(conn.id, { type: 'state.snapshot', payload: this.snapshotFor(session) });
    }
  }

  private attach(conn: Conn, session: Session): void {
    const now = this.now();
    conn.userId = session.userId;
    conn.lastPongAt = now;
    conn.lastPingAt = now;
  }

  private sendReady(conn: Conn, session: Session, requestId: string, resumed: boolean): void {
    this.send(conn.id, {
      type: 'session.ready',
      requestId,
      payload: {
        userId: session.userId,
        sessionToken: session.token,
        resumed,
        serverInstanceId: this.serverInstanceId,
        config: this.config,
      },
    });
  }

  /** 연결이 끊긴 세션을 disconnected로 전환한다. 상태가 바뀌면 true. */
  private detachSession(conn: Conn): boolean {
    if (!conn.userId) return false;
    const session = this.sessions.get(conn.userId);
    conn.userId = null;
    if (!session || session.connId !== conn.id) return false; // 이미 교체된 연결
    session.connId = null;
    session.status = 'disconnected';
    session.graceExpiresAt = this.now() + this.config.gracePeriodMs;

    // 입장권 보유 중 끊기면 입장권과 대기열 항목을 즉시 제거 (FR-13)
    if (this.priority?.userId === session.userId) {
      this.removeFromQueue(session.userId);
      this.priority = null;
    }
    this.reconcilePriority();
    this.commit();
    return true;
  }

  private removeSession(session: Session): void {
    if (this.occupantId === session.userId) this.setOccupant(null);
    this.removeFromQueue(session.userId);
    if (this.priority?.userId === session.userId) this.priority = null;
    this.sessions.delete(session.userId);
    this.tokens.delete(session.token);
  }

  private handlePong(conn: Conn, nonce: unknown): void {
    if (!conn.userId || typeof nonce !== 'string') return;
    if (!conn.pendingNonces.delete(nonce)) return;
    conn.lastPongAt = this.now();
  }

  private rememberRequestId(conn: Conn, requestId: string, now: number): void {
    for (const [id, at] of conn.seenRequestIds) {
      if (now - at > REQUEST_ID_TTL_MS) conn.seenRequestIds.delete(id);
      else break;
    }
    conn.seenRequestIds.set(requestId, now);
    while (conn.seenRequestIds.size > REQUEST_ID_MAX) {
      const oldest = conn.seenRequestIds.keys().next().value;
      if (oldest === undefined) break;
      conn.seenRequestIds.delete(oldest);
    }
  }

  // ---------- 부스 / 대기열 / 액션 ----------

  private enterBooth(conn: Conn, session: Session, requestId: string): void {
    if (this.occupantId === session.userId) return this.sendError(conn, requestId, 'ALREADY_IN_BOOTH');
    if (this.occupantId) return this.sendError(conn, requestId, 'BOOTH_OCCUPIED');
    if (this.priority && this.priority.userId !== session.userId) {
      return this.sendError(conn, requestId, 'BOOTH_RESERVED');
    }
    this.removeFromQueue(session.userId);
    this.priority = null;
    this.setOccupant(session.userId);
    this.reconcilePriority();
    this.commit();
    this.ok(conn, requestId, 'booth.enter');
  }

  private leaveBooth(conn: Conn, session: Session, requestId: string): void {
    if (this.occupantId !== session.userId) return this.sendError(conn, requestId, 'NOT_IN_BOOTH');
    this.setOccupant(null);
    this.reconcilePriority();
    this.commit();
    this.ok(conn, requestId, 'booth.leave');
  }

  private joinQueue(conn: Conn, session: Session, requestId: string): void {
    if (this.occupantId === session.userId) return this.sendError(conn, requestId, 'ALREADY_IN_BOOTH');
    if (!this.occupantId) return this.sendError(conn, requestId, 'BOOTH_EMPTY');
    if (this.queue.includes(session.userId)) return this.sendError(conn, requestId, 'ALREADY_IN_QUEUE');
    this.queue.push(session.userId);
    this.commit();
    this.ok(conn, requestId, 'queue.join');
  }

  private cancelQueue(conn: Conn, session: Session, requestId: string): void {
    if (!this.queue.includes(session.userId)) return this.sendError(conn, requestId, 'NOT_IN_QUEUE');
    this.removeFromQueue(session.userId);
    if (this.priority?.userId === session.userId) this.priority = null;
    this.reconcilePriority();
    this.commit();
    this.ok(conn, requestId, 'queue.cancel');
  }

  private performAction(conn: Conn, session: Session, requestId: string, action: unknown): void {
    if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
      return this.sendError(conn, requestId, 'BAD_REQUEST');
    }
    const type = action as ActionType;

    if (type === 'knock') {
      if (!this.occupantId) return this.sendError(conn, requestId, 'BOOTH_EMPTY');
      if (this.queue[0] !== session.userId) return this.sendError(conn, requestId, 'NOT_QUEUE_HEAD');
    } else if (this.occupantId !== session.userId) {
      return this.sendError(conn, requestId, 'NOT_IN_BOOTH');
    }

    const now = this.now();
    const until = session.cooldownUntil[type];
    if (now < until) {
      return this.sendError(conn, requestId, 'COOLDOWN', { retryAfterMs: until - now, cooldownUntil: until });
    }
    const nextUntil = now + this.config.cooldownsMs[type];
    session.cooldownUntil[type] = nextUntil;

    this.ok(conn, requestId, 'action.perform', { cooldownUntil: { [type]: nextUntil } });
    const eventId = `snd_${randomBytes(6).toString('hex')}`;
    for (const target of this.sessions.values()) {
      if (target.connId) {
        this.send(target.connId, {
          type: 'sound.play',
          payload: { eventId, actorId: session.userId, action: type, occurredAt: now },
        });
      }
    }
  }

  // ---------- 상태 보조 ----------

  private setOccupant(userId: string | null): void {
    this.occupantId = userId;
    this.occupiedSince = userId ? this.now() : null;
  }

  private removeFromQueue(userId: string): void {
    this.queue = this.queue.filter((id) => id !== userId);
  }

  /** 부스가 비었을 때 입장권 대상을 정한다. 상태가 바뀌면 true. */
  private reconcilePriority(): boolean {
    if (this.occupantId) {
      const had = this.priority !== null;
      this.priority = null;
      return had;
    }
    if (this.priority) {
      const target = this.sessions.get(this.priority.userId);
      if (target?.status === 'connected' && this.queue.includes(target.userId)) return false;
      this.priority = null;
    }
    for (const userId of this.queue) {
      if (this.sessions.get(userId)?.status === 'connected') {
        this.priority = { userId, expiresAt: this.now() + this.config.priorityWindowMs };
        return true;
      }
    }
    return false;
  }

  private commit(): void {
    this.revision += 1;
    for (const session of this.sessions.values()) {
      if (session.connId) {
        this.send(session.connId, { type: 'state.snapshot', payload: this.snapshotFor(session) });
      }
    }
  }

  private snapshotFor(session: Session): Snapshot {
    return {
      serverInstanceId: this.serverInstanceId,
      revision: this.revision,
      participants: [...this.sessions.values()].map((s) => ({
        userId: s.userId,
        name: s.name,
        status: s.status,
        graceExpiresAt: s.graceExpiresAt,
      })),
      booth: { occupantId: this.occupantId, occupiedSince: this.occupiedSince },
      queue: [...this.queue],
      priority: this.priority ? { ...this.priority } : null,
      self: { userId: session.userId, cooldownUntil: { ...session.cooldownUntil } },
    };
  }

  private ok(
    conn: Conn,
    requestId: string,
    operation: string,
    extra: { cooldownUntil?: Partial<Record<ActionType, number>> } = {},
  ): void {
    this.send(conn.id, {
      type: 'request.ok',
      requestId,
      payload: { operation, revision: this.revision, ...extra },
    });
  }

  private sendError(
    conn: Conn,
    requestId: string | undefined,
    code: ErrorCode,
    extra: { retryAfterMs?: number; cooldownUntil?: number } = {},
  ): void {
    this.send(conn.id, {
      type: 'request.error',
      ...(requestId ? { requestId } : {}),
      payload: { code, message: ERROR_MESSAGES[code], ...extra },
    });
  }

  private send(connId: string, message: ServerMessage): void {
    this.out.send(connId, { v: PROTOCOL_VERSION, serverTime: this.now(), ...message } as ServerEnvelope);
  }
}
