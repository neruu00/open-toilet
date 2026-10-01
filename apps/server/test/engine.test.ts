import { describe, expect, it, beforeEach } from 'vitest';
import type { ServerEnvelope } from '@open-toilet/protocol';
import { Engine } from '../src/domain/engine.js';

let clock = 0;
let sent: Record<string, ServerEnvelope[]>;
let closed: Record<string, number>;
let engine: Engine;
let seq = 0;

beforeEach(() => {
  clock = 1_000_000;
  sent = {};
  closed = {};
  seq = 0;
  engine = new Engine({
    now: () => clock,
    out: {
      send: (id, m) => void (sent[id] ??= []).push(m),
      close: (id, code) => void (closed[id] = code),
    },
  });
});

function raw(id: string, type: string, payload: object = {}) {
  engine.message(id, JSON.stringify({ v: 1, type, requestId: `r${++seq}`, payload }));
}

function last(id: string, type: string) {
  return [...(sent[id] ?? [])].reverse().find((m) => m.type === type);
}

function join(id: string, name: string) {
  engine.connect(id);
  raw(id, 'session.open', { name });
  const ready = last(id, 'session.ready');
  if (!ready || ready.type !== 'session.ready') throw new Error('not ready');
  return ready.payload;
}

function snap(id: string) {
  const m = last(id, 'state.snapshot');
  if (!m || m.type !== 'state.snapshot') throw new Error('no snapshot');
  return m.payload;
}

function errCode(id: string) {
  const m = last(id, 'request.error');
  return m && m.type === 'request.error' ? m.payload.code : undefined;
}

function soundCount(id: string) {
  return (sent[id] ?? []).filter((m) => m.type === 'sound.play').length;
}

function advance(ms: number) {
  clock += ms;
  engine.tick();
}

/** 5초 단위로 시간을 보내며 지정한 연결은 하트비트에 응답한다. */
function advanceAlive(ms: number, ids: string[]) {
  for (let elapsed = 0; elapsed < ms; elapsed += 5000) {
    advance(Math.min(5000, ms - elapsed));
    ids.forEach(pong);
  }
}

function pong(id: string) {
  const ping = last(id, 'heartbeat.ping');
  if (ping?.type !== 'heartbeat.ping') return;
  engine.message(id, JSON.stringify({ v: 1, type: 'heartbeat.pong', payload: { nonce: ping.payload.nonce } }));
}

describe('이름 / 세션', () => {
  it('이름 검증: 공백만, 13자, 제어문자는 거절하고 중복 이름은 허용한다', () => {
    engine.connect('a');
    raw('a', 'session.open', { name: '   ' });
    expect(errCode('a')).toBe('NAME_INVALID');
    raw('a', 'session.open', { name: '가'.repeat(13) });
    expect(errCode('a')).toBe('NAME_INVALID');
    raw('a', 'session.open', { name: 'a\nb' });
    expect(errCode('a')).toBe('NAME_INVALID');
    raw('a', 'session.open', { name: '  민수 😀 ' });
    const u1 = last('a', 'session.ready');
    expect(u1).toBeTruthy();

    const u2 = join('b', '민수');
    expect(u1?.type === 'session.ready' && u1.payload.userId).not.toBe(u2.userId);
  });

  it('인증 전에는 동작을 거절하고 5초 안에 인증 안 하면 끊는다', () => {
    engine.connect('a');
    raw('a', 'booth.enter');
    expect(errCode('a')).toBe('SESSION_REQUIRED');
    advance(5000);
    expect(closed.a).toBe(4001);
  });

  it('같은 requestId 재사용은 DUPLICATE_REQUEST', () => {
    join('a', 'A');
    engine.message('a', JSON.stringify({ v: 1, type: 'state.sync', requestId: 'dup', payload: {} }));
    engine.message('a', JSON.stringify({ v: 1, type: 'state.sync', requestId: 'dup', payload: {} }));
    expect(errCode('a')).toBe('DUPLICATE_REQUEST');
  });
});

describe('부스', () => {
  it('먼저 입장한 사람만 성공하고 나머지는 BOOTH_OCCUPIED', () => {
    join('a', 'A');
    join('b', 'B');
    raw('a', 'booth.enter');
    raw('b', 'booth.enter');
    expect(errCode('b')).toBe('BOOTH_OCCUPIED');
    expect(snap('b').booth.occupantId).toBe(snap('a').self.userId);
  });

  it('부스 밖에서 방귀/물 내리기는 거절', () => {
    join('a', 'A');
    raw('a', 'action.perform', { action: 'fart' });
    expect(errCode('a')).toBe('NOT_IN_BOOTH');
  });

  it('방귀는 본인 포함 전원에게 sound.play, 쿨다운 중에는 거절', () => {
    join('a', 'A');
    join('b', 'B');
    raw('a', 'booth.enter');
    raw('a', 'action.perform', { action: 'fart' });
    expect(soundCount('a')).toBe(1);
    expect(soundCount('b')).toBe(1);

    advance(1000);
    raw('a', 'action.perform', { action: 'fart' });
    expect(errCode('a')).toBe('COOLDOWN');
    expect(soundCount('b')).toBe(1);

    raw('a', 'action.perform', { action: 'flush' }); // 액션별 독립 쿨다운
    expect(soundCount('b')).toBe(2);

    advance(2100);
    raw('a', 'action.perform', { action: 'fart' });
    expect(soundCount('b')).toBe(3);
  });
});

describe('대기열 / 우선 입장', () => {
  it('비어 있으면 줄 설 수 없고, 사용 중이면 FIFO로 선다', () => {
    join('a', 'A');
    join('b', 'B');
    join('c', 'C');
    raw('b', 'queue.join');
    expect(errCode('b')).toBe('BOOTH_EMPTY');
    raw('a', 'booth.enter');
    raw('a', 'queue.join');
    expect(errCode('a')).toBe('ALREADY_IN_BOOTH');
    raw('b', 'queue.join');
    raw('c', 'queue.join');
    raw('c', 'queue.join');
    expect(errCode('c')).toBe('ALREADY_IN_QUEUE');
    expect(snap('a').queue).toEqual([snap('b').self.userId, snap('c').self.userId]);
  });

  it('맨 앞만 노크 가능하고 모두가 소리를 듣는다', () => {
    join('a', 'A');
    join('b', 'B');
    join('c', 'C');
    raw('a', 'booth.enter');
    raw('b', 'queue.join');
    raw('c', 'queue.join');
    raw('c', 'action.perform', { action: 'knock' });
    expect(errCode('c')).toBe('NOT_QUEUE_HEAD');
    raw('b', 'action.perform', { action: 'knock' });
    for (const id of ['a', 'b', 'c']) {
      const m = last(id, 'sound.play');
      expect(m?.type === 'sound.play' && m.payload.action).toBe('knock');
    }
  });

  it('퇴장하면 맨 앞에게 10초 입장권, 다른 사람은 입장 불가, 만료되면 다음 사람', () => {
    join('a', 'A');
    join('b', 'B');
    join('c', 'C');
    join('d', 'D');
    raw('a', 'booth.enter');
    raw('b', 'queue.join');
    raw('c', 'queue.join');
    raw('a', 'booth.leave');
    const bId = snap('b').self.userId;
    const cId = snap('c').self.userId;
    expect(snap('d').priority?.userId).toBe(bId);

    raw('d', 'booth.enter');
    expect(errCode('d')).toBe('BOOTH_RESERVED');
    raw('c', 'booth.enter');
    expect(errCode('c')).toBe('BOOTH_RESERVED');

    advance(10_000);
    expect(snap('d').priority?.userId).toBe(cId);
    expect(snap('d').queue).toEqual([cId]);

    advance(10_000);
    expect(snap('d').priority).toBeNull();
    raw('d', 'booth.enter');
    expect(snap('d').booth.occupantId).toBe(snap('d').self.userId);
  });

  it('입장권 보유자가 입장하면 대기열에서 빠진다', () => {
    join('a', 'A');
    join('b', 'B');
    raw('a', 'booth.enter');
    raw('b', 'queue.join');
    raw('a', 'booth.leave');
    raw('b', 'booth.enter');
    const s = snap('b');
    expect(s.booth.occupantId).toBe(s.self.userId);
    expect(s.queue).toEqual([]);
    expect(s.priority).toBeNull();
  });

  it('대기 취소 후 재참여하면 맨 뒤', () => {
    join('a', 'A');
    join('b', 'B');
    join('c', 'C');
    raw('a', 'booth.enter');
    raw('b', 'queue.join');
    raw('c', 'queue.join');
    raw('b', 'queue.cancel');
    raw('b', 'queue.join');
    expect(snap('a').queue).toEqual([snap('c').self.userId, snap('b').self.userId]);
  });
});

describe('접속 상태(presence)', () => {
  it('끊기면 disconnected 유지, 유예 안에 토큰으로 복구하면 자리와 쿨다운 유지', () => {
    const a = join('a', 'A');
    join('b', 'B');
    raw('a', 'booth.enter');
    raw('a', 'action.perform', { action: 'flush' });
    engine.close('a');
    expect(snap('b').participants.find((p) => p.userId === a.userId)?.status).toBe('disconnected');
    expect(snap('b').booth.occupantId).toBe(a.userId);

    advanceAlive(2_000, ['b']);
    engine.connect('a2');
    raw('a2', 'session.open', { sessionToken: a.sessionToken });
    const ready = last('a2', 'session.ready');
    expect(ready?.type === 'session.ready' && ready.payload.resumed).toBe(true);
    expect(ready?.type === 'session.ready' && ready.payload.userId).toBe(a.userId);
    expect(snap('b').participants.find((p) => p.userId === a.userId)?.status).toBe('connected');
    expect(snap('a2').self.cooldownUntil.flush).toBeGreaterThan(clock);
  });

  it('유예 만료 시 부스 점유자는 강제 퇴장되고 대기자에게 입장권이 간다', () => {
    const a = join('a', 'A');
    join('b', 'B');
    raw('a', 'booth.enter');
    raw('b', 'queue.join');
    engine.close('a');
    advanceAlive(30_000, ['b']);
    const s = snap('b');
    expect(s.participants.some((p) => p.userId === a.userId)).toBe(false);
    expect(s.booth.occupantId).toBeNull();
    expect(s.priority?.userId).toBe(s.self.userId);

    engine.connect('a2');
    raw('a2', 'session.open', { sessionToken: a.sessionToken });
    expect(errCode('a2')).toBe('SESSION_INVALID');
  });

  it('끊긴 대기자는 건너뛰고 입장권을 주며, 복구해도 빼앗지 않는다', () => {
    join('a', 'A');
    const b = join('b', 'B');
    join('c', 'C');
    raw('a', 'booth.enter');
    raw('b', 'queue.join');
    raw('c', 'queue.join');
    engine.close('b');
    raw('a', 'booth.leave');
    const cId = snap('c').self.userId;
    expect(snap('c').priority?.userId).toBe(cId);

    engine.connect('b2');
    raw('b2', 'session.open', { sessionToken: b.sessionToken });
    expect(snap('b2').priority?.userId).toBe(cId);
    expect(snap('b2').queue[0]).toBe(b.userId);
  });

  it('입장권 보유 중 끊기면 즉시 다음 사람에게 넘어간다', () => {
    join('a', 'A');
    const b = join('b', 'B');
    join('c', 'C');
    raw('a', 'booth.enter');
    raw('b', 'queue.join');
    raw('c', 'queue.join');
    raw('a', 'booth.leave');
    engine.close('b');
    const s = snap('c');
    expect(s.priority?.userId).toBe(s.self.userId);
    expect(s.queue).not.toContain(b.userId);
  });

  it('모든 대기자가 disconnected면 입장권 없이 누구나 입장 가능', () => {
    join('a', 'A');
    join('b', 'B');
    join('c', 'C');
    raw('a', 'booth.enter');
    raw('b', 'queue.join');
    engine.close('b');
    raw('a', 'booth.leave');
    expect(snap('c').priority).toBeNull();
    raw('c', 'booth.enter');
    expect(snap('c').booth.occupantId).toBe(snap('c').self.userId);
  });

  it('하트비트: pong이 없으면 30초 뒤 연결을 끊고 disconnected', () => {
    join('a', 'A');
    const b = join('b', 'B');
    for (let i = 0; i < 3; i++) {
      advance(10_000);
      pong('a'); // b는 응답하지 않는다
    }
    expect(closed.b).toBe(4002);
    expect(snap('a').participants.find((p) => p.userId === b.userId)?.status).toBe('disconnected');
  });

  it('같은 토큰으로 새 연결이 오면 이전 연결을 대체하고 자리는 유지', () => {
    const a = join('a', 'A');
    raw('a', 'booth.enter');
    engine.connect('a2');
    raw('a2', 'session.open', { sessionToken: a.sessionToken });
    expect(closed.a).toBe(4009);
    expect(last('a', 'session.replaced')).toBeTruthy();
    engine.close('a'); // 이전 소켓의 늦은 close가 새 연결에 영향 주지 않는다
    const s = snap('a2');
    expect(s.booth.occupantId).toBe(a.userId);
    expect(s.participants.find((p) => p.userId === a.userId)?.status).toBe('connected');
  });
});
