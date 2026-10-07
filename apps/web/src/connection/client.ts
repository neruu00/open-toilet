import {
  PROTOCOL_VERSION,
  type ActionType,
  type Config,
  type ErrorCode,
  type ServerEnvelope,
  type Snapshot,
} from '@open-toilet/protocol';
import { sound } from '../audio/sound';

export type Phase = 'booting' | 'name' | 'connecting' | 'ready' | 'reconnecting' | 'replaced';

export interface Activity {
  id: string;
  text: string;
}

export interface ClientState {
  phase: Phase;
  snapshot: Snapshot | null;
  userId: string | null;
  config: Config | null;
  nameError: string | null;
  notice: string | null;
  activities: Activity[];
  /** 화면에 잠깐 터지는 파티클 효과 (id는 sound.play의 eventId) */
  effects: { id: string }[];
  /** userId → 머리 위에 떠 있는 말풍선 */
  bubbles: Record<string, { id: string; text: string }>;
  /** 서버 시각 - 로컬 시각 */
  clockOffset: number;
  audioLocked: boolean;
  muted: boolean;
  tokenPersisted: boolean;
}

const TOKEN_KEY = 'open-toilet.token';
const WATCHDOG_MS = 30_000;
const SOUND_MAX_AGE_MS = 2_000;
const MAX_CONCURRENT_EVENT_IDS = 256;
const EFFECT_MS = 1_800;

const ACTION_TEXT: Record<ActionType, string> = {
  fart: '방귀를 뀌었습니다 💨',
  poop: '똥을 쌌습니다 💩',
  flush: '물을 내렸습니다 🚽',
  knock: '문을 두드립니다 ✊',
};

type Listener = () => void;

export class GameClient {
  private state: ClientState = {
    phase: 'booting',
    snapshot: null,
    userId: null,
    config: null,
    nameError: null,
    notice: null,
    activities: [],
    effects: [],
    bubbles: {},
    clockOffset: 0,
    audioLocked: true,
    muted: sound.muted,
    tokenPersisted: true,
  };
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private memoryToken: string | null = null;
  private pendingName: string | null = null;
  private attempt = 0;
  private retryTimer: number | null = null;
  private lastMessageAt = 0;
  private requestSeq = 0;
  private pending = new Map<string, { resolve: (ok: boolean) => void }>();
  private seenEventIds: string[] = [];
  private noticeTimer: number | null = null;
  private bubbleTimers = new Map<string, number>();
  private watchdog: number | null = null;
  private started = false;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ClientState => this.state;

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', () => this.reconnectNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      this.refreshAudio();
      if (this.ws?.readyState === WebSocket.OPEN) void this.sync();
      else this.reconnectNow();
    });
    // 소리 버튼이 없으므로, 새로고침 복구처럼 제스처 없이 들어온 경우를 위해
    // 화면의 첫 클릭/터치/키 입력에서 오디오를 unlock 한다.
    const unlockOnGesture = () => {
      void sound.unlock().then(() => {
        this.refreshAudio();
        if (!sound.locked) {
          window.removeEventListener('pointerdown', unlockOnGesture, true);
          window.removeEventListener('keydown', unlockOnGesture, true);
        }
      });
    };
    window.addEventListener('pointerdown', unlockOnGesture, true);
    window.addEventListener('keydown', unlockOnGesture, true);
    this.watchdog = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastMessageAt > WATCHDOG_MS) {
        this.ws.close(); // 서버 메시지가 오래 없으면 끊고 재접속
      }
    }, 5_000);

    const token = this.readToken();
    if (token) {
      this.set({ phase: 'connecting' });
      this.connect({ sessionToken: token });
    } else {
      this.set({ phase: 'name' });
    }
  }

  // ---------- 사용자 동작 ----------

  /** 클릭 핸들러에서 동기적으로 호출해야 오디오 unlock이 허용된다. */
  joinWithName(name: string): void {
    void sound.unlock().then(() => this.refreshAudio());
    this.pendingName = name;
    this.set({ phase: 'connecting', nameError: null });
    this.connect({ name });
  }

  async enableSound(): Promise<void> {
    await sound.unlock();
    this.refreshAudio();
  }

  toggleMute(): void {
    sound.setMuted(!sound.muted);
    this.set({ muted: sound.muted });
  }

  reconnectTab(): void {
    this.set({ phase: 'connecting', notice: null });
    this.attempt = 0;
    const token = this.readToken();
    if (token) this.connect({ sessionToken: token });
    else this.set({ phase: 'name' });
  }

  enterBooth = () => this.request('booth.enter', {});
  leaveBooth = () => this.request('booth.leave', {});
  joinQueue = () => this.request('queue.join', {});
  cancelQueue = () => this.request('queue.cancel', {});
  perform = (action: ActionType) => this.request('action.perform', { action });
  sync = () => this.request('state.sync', {});
  chat = (text: string) => this.request('chat.send', { text });

  // ---------- 연결 ----------

  private connect(auth: { name: string } | { sessionToken: string }): void {
    this.clearRetry();
    this.closeSocket();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    let becameReady = false;

    ws.onopen = () => {
      this.lastMessageAt = Date.now();
      this.rawSend({ type: 'session.open', requestId: this.nextId(), payload: auth });
    };
    ws.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      let message: ServerEnvelope;
      try {
        message = JSON.parse(String(event.data)) as ServerEnvelope;
      } catch {
        return;
      }
      if (message.type === 'session.ready') becameReady = true;
      this.onMessage(message);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return; // 이미 교체된 소켓
      this.ws = null;
      this.failPending();
      if (event.code === 4009 || this.state.phase === 'replaced') {
        this.set({ phase: 'replaced' });
        return;
      }
      if (this.state.phase === 'name') return; // 인증 거절됨
      if ('name' in auth && !becameReady) {
        // 신규 이름 등록 중 실패: 중복 생성을 피하려고 재시도하지 않는다
        this.set({ phase: 'name', nameError: '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.' });
        return;
      }
      this.set({ phase: 'reconnecting' });
      this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  private closeSocket(): void {
    if (!this.ws) return;
    const old = this.ws;
    this.ws = null;
    old.onclose = null;
    old.close();
  }

  private scheduleRetry(): void {
    this.clearRetry();
    if (!navigator.onLine) return; // online 이벤트에서 재시도
    const base = Math.min(500 * 2 ** this.attempt, 10_000);
    const jitter = base * (0.8 + Math.random() * 0.4);
    this.attempt += 1;
    this.retryTimer = window.setTimeout(() => this.reconnectNow(), Math.min(jitter, 10_000));
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private reconnectNow(): void {
    if (this.state.phase !== 'reconnecting') return;
    const token = this.readToken();
    if (!token) return;
    this.connect({ sessionToken: token });
  }

  private nextId(): string {
    this.requestSeq += 1;
    return `c${this.requestSeq}`;
  }

  private rawSend(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
    }
  }

  private request(type: string, payload: object): Promise<boolean> {
    if (this.ws?.readyState !== WebSocket.OPEN || this.state.phase !== 'ready') return Promise.resolve(false);
    const requestId = this.nextId();
    return new Promise((resolve) => {
      this.pending.set(requestId, { resolve });
      this.rawSend({ type, requestId, payload });
    });
  }

  private failPending(): void {
    for (const { resolve } of this.pending.values()) resolve(false);
    this.pending.clear();
  }

  // ---------- 수신 ----------

  private onMessage(message: ServerEnvelope): void {
    switch (message.type) {
      case 'session.ready': {
        const { userId, sessionToken, config } = message.payload;
        this.saveToken(sessionToken);
        this.attempt = 0;
        this.pendingName = null;
        this.set({
          userId,
          config,
          phase: 'ready',
          nameError: null,
          notice: null,
          clockOffset: message.serverTime - Date.now(),
        });
        this.refreshAudio();
        break;
      }
      case 'state.snapshot': {
        const next = message.payload;
        const prev = this.state.snapshot;
        const stale = prev && prev.serverInstanceId === next.serverInstanceId && next.revision < prev.revision;
        if (!stale) this.set({ snapshot: next, clockOffset: message.serverTime - Date.now() });
        break;
      }
      case 'request.ok': {
        const { cooldownUntil } = message.payload;
        if (cooldownUntil && this.state.snapshot) {
          const snapshot = this.state.snapshot;
          this.set({
            snapshot: { ...snapshot, self: { ...snapshot.self, cooldownUntil: { ...snapshot.self.cooldownUntil, ...cooldownUntil } } },
          });
        }
        this.settle(message.requestId, true);
        break;
      }
      case 'request.error': {
        const { code, message: text, cooldownUntil } = message.payload;
        this.onError(code, text, cooldownUntil);
        this.settle(message.requestId, false);
        break;
      }
      case 'sound.play':
        this.onSound(message.payload, message.serverTime);
        break;
      case 'chat.message':
        this.onChat(message.payload);
        break;
      case 'heartbeat.ping':
        this.rawSend({ type: 'heartbeat.pong', payload: { nonce: message.payload.nonce } });
        break;
      case 'session.replaced':
        this.set({ phase: 'replaced', notice: message.payload.message });
        break;
    }
  }

  private settle(requestId: string | undefined, ok: boolean): void {
    if (!requestId) return;
    this.pending.get(requestId)?.resolve(ok);
    this.pending.delete(requestId);
  }

  private onError(code: ErrorCode, text: string, cooldownUntil?: number): void {
    if (code === 'NAME_INVALID') {
      this.set({ phase: 'name', nameError: text });
      this.closeSocket();
      return;
    }
    if (code === 'SESSION_INVALID') {
      this.clearToken();
      this.closeSocket();
      this.set({ phase: 'name', snapshot: null, userId: null, nameError: null, notice: '세션이 만료되어 이름을 다시 입력해야 해요.' });
      return;
    }
    if (code === 'COOLDOWN' && cooldownUntil && this.state.snapshot) {
      // 서버 쿨다운 종료 시각으로 맞춘다 (액션 종류는 sync로 정확히 갱신)
      void this.sync();
    }
    if (code === 'BOOTH_OCCUPIED' || code === 'BOOTH_RESERVED' || code === 'NOT_QUEUE_HEAD' || code === 'BOOTH_EMPTY') {
      void this.sync();
    }
    this.flash(text);
  }

  private onSound(
    payload: { eventId: string; actorId: string; action: ActionType; occurredAt: number },
    serverTime: number,
  ): void {
    if (this.seenEventIds.includes(payload.eventId)) return;
    this.seenEventIds.push(payload.eventId);
    if (this.seenEventIds.length > MAX_CONCURRENT_EVENT_IDS) this.seenEventIds.shift();

    const name = this.state.snapshot?.participants.find((p) => p.userId === payload.actorId)?.name ?? '누군가';
    const activity: Activity = { id: payload.eventId, text: `${name}님이 ${ACTION_TEXT[payload.action]}` };
    this.set({ activities: [...this.state.activities, activity].slice(-3) });
    window.setTimeout(() => {
      this.set({ activities: this.state.activities.filter((a) => a.id !== activity.id) });
    }, 4_000);

    if (serverTime - payload.occurredAt > SOUND_MAX_AGE_MS) return; // 오래된 소리·효과는 재생하지 않는다
    sound.play(payload.action);
    if (payload.action === 'poop') this.addEffect(payload.eventId);
  }

  private addEffect(id: string): void {
    this.set({ effects: [...this.state.effects, { id }] });
    window.setTimeout(() => {
      this.set({ effects: this.state.effects.filter((e) => e.id !== id) });
    }, EFFECT_MS);
  }

  /** 말풍선은 글자 수에 비례해 5~10초 동안 보이고, 같은 사람의 새 메시지가 오면 교체된다. */
  private onChat(payload: { messageId: string; userId: string; text: string }): void {
    const { userId, messageId, text } = payload;
    const previous = this.bubbleTimers.get(userId);
    if (previous !== undefined) window.clearTimeout(previous);
    this.set({ bubbles: { ...this.state.bubbles, [userId]: { id: messageId, text } } });
    const visibleMs = Math.min(10_000, 5_000 + [...text].length * 80);
    this.bubbleTimers.set(
      userId,
      window.setTimeout(() => {
        this.bubbleTimers.delete(userId);
        const { [userId]: _removed, ...rest } = this.state.bubbles;
        this.set({ bubbles: rest });
      }, visibleMs),
    );
  }

  // ---------- 보조 ----------

  private flash(text: string): void {
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.set({ notice: text });
    this.noticeTimer = window.setTimeout(() => this.set({ notice: null }), 3_500);
  }

  private refreshAudio(): void {
    this.set({ audioLocked: sound.locked, muted: sound.muted });
  }

  private readToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? this.memoryToken;
    } catch {
      return this.memoryToken;
    }
  }

  private saveToken(token: string): void {
    this.memoryToken = token;
    try {
      localStorage.setItem(TOKEN_KEY, token);
      this.set({ tokenPersisted: true });
    } catch {
      this.set({ tokenPersisted: false });
    }
  }

  private clearToken(): void {
    this.memoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}

export const client = new GameClient();
