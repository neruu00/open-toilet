import { describe, expect, it, beforeEach } from 'vitest';
import type { ServerEnvelope } from '@open-toilet/protocol';
import { Engine } from '../src/domain/engine.js';

let clock = 0;
let sent: Record<string, ServerEnvelope[]>;
let closed: Record<string, number>;
let engine: Engine;
let seq = 0;
/** 엔진이 쓰는 난수. 기본값은 확률 변주(기침·도넛)가 생기지 않는 쪽 */
let nextRandom = 0.99;

beforeEach(() => {
  clock = 1_000_000;
  sent = {};
  closed = {};
  seq = 0;
  nextRandom = 0.99;
  engine = new Engine({
    now: () => clock,
    random: () => nextRandom,
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

describe('채팅', () => {
  it('본인 포함 전원에게 chat.message를 전달하고 앞뒤 공백은 제거한다', () => {
    const a = join('a', 'A');
    join('b', 'B');
    raw('a', 'chat.send', { text: '  안녕하세요  ' });
    for (const id of ['a', 'b']) {
      const m = last(id, 'chat.message');
      expect(m?.type === 'chat.message' && m.payload.text).toBe('안녕하세요');
      expect(m?.type === 'chat.message' && m.payload.userId).toBe(a.userId);
    }
  });

  it('빈 메시지, 60자 초과, 제어문자는 거절하고 브로드캐스트하지 않는다', () => {
    join('a', 'A');
    join('b', 'B');
    for (const text of ['   ', '가'.repeat(61), 'a\nb']) {
      raw('a', 'chat.send', { text });
      expect(errCode('a')).toBe('BAD_REQUEST');
    }
    expect(last('b', 'chat.message')).toBeUndefined();
  });

  it('쿨다운 1초 안에는 거절, 지나면 다시 가능', () => {
    join('a', 'A');
    join('b', 'B');
    raw('a', 'chat.send', { text: '하나' });
    raw('a', 'chat.send', { text: '둘' });
    expect(errCode('a')).toBe('COOLDOWN');
    expect((sent.b ?? []).filter((m) => m.type === 'chat.message').length).toBe(1);
    advance(1000);
    pong('a');
    pong('b');
    raw('a', 'chat.send', { text: '셋' });
    expect((sent.b ?? []).filter((m) => m.type === 'chat.message').length).toBe(2);
  });

  it('인증 전에는 채팅할 수 없다', () => {
    engine.connect('x');
    raw('x', 'chat.send', { text: 'hi' });
    expect(errCode('x')).toBe('SESSION_REQUIRED');
  });
});

describe('똥', () => {
  it('부스 안에서만 가능하고, 전원에게 sound.play(poop)를 보내며 4초 쿨다운이 독립적으로 적용된다', () => {
    join('a', 'A');
    join('b', 'B');
    raw('b', 'action.perform', { action: 'poop' });
    expect(errCode('b')).toBe('NOT_IN_BOOTH');

    raw('a', 'booth.enter');
    raw('a', 'action.perform', { action: 'poop' });
    for (const id of ['a', 'b']) {
      const m = last(id, 'sound.play');
      expect(m?.type === 'sound.play' && m.payload.action).toBe('poop');
    }

    advance(1000);
    raw('a', 'action.perform', { action: 'poop' });
    expect(errCode('a')).toBe('COOLDOWN');
    expect(soundCount('b')).toBe(1);

    raw('a', 'action.perform', { action: 'fart' }); // 다른 액션은 쿨다운이 따로다
    expect(soundCount('b')).toBe(2);

    advance(3100);
    pong('a');
    pong('b');
    raw('a', 'action.perform', { action: 'poop' });
    expect(soundCount('b')).toBe(3);
  });
});

describe('담배', () => {
  function smoke(id: string, action: string) {
    raw(id, 'action.perform', { action });
  }

  /** 쿨다운을 넘기면서 연결을 유지한다 */
  function wait(ms: number, ids: string[] = ['a']) {
    advance(ms);
    ids.forEach(pong);
  }

  it('꺼내기 → 불 붙이기 → 흡입 → 내뿜기 순서를 지키고, 상태를 전원에게 공개한다', () => {
    join('a', 'A');
    join('b', 'B');
    smoke('b', 'take');
    expect(errCode('b')).toBe('NOT_IN_BOOTH');

    raw('a', 'booth.enter');
    for (const action of ['light', 'puff', 'ash', 'snuff_wall']) {
      smoke('a', action);
      expect(errCode('a')).toBe('NO_CIGARETTE');
    }

    smoke('a', 'take');
    expect(snap('b').booth.cigarette).toMatchObject({ litAt: null, puffs: 0 });
    expect(last('b', 'sound.play')).toMatchObject({ payload: { action: 'take' } });
    wait(2100, ['a', 'b']);
    smoke('a', 'take');
    expect(errCode('a')).toBe('ALREADY_HAS_CIGARETTE');
    for (const action of ['puff', 'exhale', 'ash', 'snuff_floor']) {
      smoke('a', action);
      expect(errCode('a')).toBe('CIGARETTE_NOT_LIT');
    }

    smoke('a', 'light');
    expect(snap('b').booth.cigarette?.litAt).toBe(clock);
    wait(3100, ['a', 'b']);
    smoke('a', 'light');
    expect(errCode('a')).toBe('CIGARETTE_LIT');
    smoke('a', 'exhale');
    expect(errCode('a')).toBe('NOT_INHALED');

    smoke('a', 'puff');
    expect(snap('b').booth.cigarette).toMatchObject({ puffs: 1, inhaling: true });
    smoke('a', 'exhale');
    expect(snap('b').booth.cigarette).toMatchObject({ puffs: 1, inhaling: false });
  });

  it('재 털기는 지금까지 탄 양을 기록해 매달린 재를 없앤다', () => {
    join('a', 'A');
    raw('a', 'booth.enter');
    smoke('a', 'take');
    wait(2100);
    smoke('a', 'light');
    wait(10_000);
    smoke('a', 'puff');
    smoke('a', 'ash');
    // 10초 + 한 모금만큼 탔다
    expect(snap('a').booth.cigarette?.ashClearedAt).toBe(10_000 + engine.config.cigarettePuffBurnMs);
  });

  it.each(['snuff_wall', 'snuff_toilet', 'snuff_floor'])('%s: 불붙은 담배를 끄면 손에서 사라지고 다시 꺼낼 수 있다', (snuff) => {
    join('a', 'A');
    join('b', 'B');
    raw('a', 'booth.enter');
    smoke('a', 'take');
    wait(2100, ['a', 'b']);
    smoke('a', 'light');
    smoke('a', snuff);
    expect(snap('b').booth.cigarette).toBeNull();
    expect(last('b', 'sound.play')).toMatchObject({ payload: { action: snuff } });

    smoke('a', 'take');
    expect(snap('b').booth.cigarette).toMatchObject({ litAt: null });
  });

  it('거절된 담배 액션은 쿨다운을 쓰지 않는다', () => {
    join('a', 'A');
    raw('a', 'booth.enter');
    smoke('a', 'exhale');
    expect(errCode('a')).toBe('NO_CIGARETTE');
    expect(snap('a').self.cooldownUntil.exhale).toBe(0);
  });

  it('그냥 두면 시간이 지나 필터까지 타서 꺼지고, 빨수록 빨리 탄다', () => {
    join('a', 'A');
    raw('a', 'booth.enter');
    smoke('a', 'take');
    wait(2100);
    smoke('a', 'light');
    advanceAlive(engine.config.cigaretteBurnMs - 5_000, ['a']);
    expect(snap('a').booth.cigarette).not.toBeNull();
    advanceAlive(5_000, ['a']);
    expect(snap('a').booth.cigarette).toBeNull();
    // 끄지 않고 다 태우면 손가락을 덴다
    expect(last('a', 'sound.play')).toMatchObject({ payload: { action: 'burnout' } });

    // 다시 피우면서 계속 빨면 시간보다 일찍 다 탄다
    smoke('a', 'take');
    wait(2100);
    smoke('a', 'light');
    const puffsToBurn = Math.ceil(engine.config.cigaretteBurnMs / engine.config.cigarettePuffBurnMs);
    let puffs = 0;
    while (snap('a').booth.cigarette && puffs < puffsToBurn) {
      wait(1600);
      smoke('a', 'puff');
      wait(1600);
      smoke('a', 'exhale');
      puffs += 1;
    }
    expect(snap('a').booth.cigarette).toBeNull();
    expect(puffs).toBeLessThan(puffsToBurn);
  });

  it('흡입하다 확률로 기침하고, 내뿜은 연기가 확률로 도넛이 된다 (서버가 정해 모두에게 같게 보낸다)', () => {
    join('a', 'A');
    join('b', 'B');
    raw('a', 'booth.enter');
    smoke('a', 'take');
    wait(2100, ['a', 'b']);
    smoke('a', 'light');

    nextRandom = 0.99;
    smoke('a', 'puff');
    expect(last('b', 'sound.play')?.payload).not.toHaveProperty('variant');
    wait(1600, ['a', 'b']);
    smoke('a', 'exhale');
    expect(last('b', 'sound.play')?.payload).not.toHaveProperty('variant');

    nextRandom = 0;
    wait(1600, ['a', 'b']);
    smoke('a', 'puff');
    for (const id of ['a', 'b']) expect(last(id, 'sound.play')).toMatchObject({ payload: { action: 'puff', variant: 'cough' } });
    wait(1600, ['a', 'b']);
    smoke('a', 'exhale');
    for (const id of ['a', 'b']) expect(last(id, 'sound.play')).toMatchObject({ payload: { action: 'exhale', variant: 'ring' } });
  });

  it('빨다가 필터까지 다 태우면 그 자리에서 손가락을 덴다', () => {
    join('a', 'A');
    raw('a', 'booth.enter');
    smoke('a', 'take');
    wait(2100);
    smoke('a', 'light');
    // 거의 다 탄 상태에서 한 모금
    advanceAlive(engine.config.cigaretteBurnMs - engine.config.cigarettePuffBurnMs, ['a']);
    smoke('a', 'puff');
    expect(snap('a').booth.cigarette).toBeNull();
    const sounds = (sent.a ?? []).filter((m) => m.type === 'sound.play').slice(-2);
    expect(sounds.map((m) => m.type === 'sound.play' && m.payload.action)).toEqual(['puff', 'burnout']);
  });

  it('직접 끄면 손가락을 데지 않는다', () => {
    join('a', 'A');
    raw('a', 'booth.enter');
    smoke('a', 'take');
    wait(2100);
    smoke('a', 'light');
    smoke('a', 'snuff_wall');
    advanceAlive(engine.config.cigaretteBurnMs, ['a']);
    expect((sent.a ?? []).some((m) => m.type === 'sound.play' && m.payload.action === 'burnout')).toBe(false);
  });

  it('부스를 나가면 들고 있던 담배는 사라진다', () => {
    join('a', 'A');
    raw('a', 'booth.enter');
    smoke('a', 'take');
    raw('a', 'booth.leave');
    expect(snap('a').booth.cigarette).toBeNull();
  });
});

describe('로비로 나가기 (session.close)', () => {
  it('부스 사용자가 나가면 유예 없이 바로 비우고 다음 대기자에게 입장권을 준다', () => {
    const a = join('a', 'A');
    join('b', 'B');
    raw('a', 'booth.enter');
    raw('b', 'queue.join');

    raw('a', 'session.close');
    expect(last('a', 'request.ok')).toMatchObject({ payload: { operation: 'session.close' } });
    expect(closed.a).toBe(1000);
    const s = snap('b');
    expect(s.participants.map((p) => p.userId)).not.toContain(a.userId);
    expect(s.booth.occupantId).toBeNull();
    expect(s.priority?.userId).toBe(s.self.userId);

    // 지운 세션의 토큰으로는 복구할 수 없다
    engine.connect('a2');
    raw('a2', 'session.open', { sessionToken: a.sessionToken });
    expect(errCode('a2')).toBe('SESSION_INVALID');
  });

  it('인증 전에는 나갈 세션이 없다', () => {
    engine.connect('x');
    raw('x', 'session.close');
    expect(errCode('x')).toBe('SESSION_REQUIRED');
  });
});

describe('침 / 가래침 / 닦기', () => {
  it.each(['spit', 'phlegm', 'wipe'])('%s: 부스 안에서만 가능하고 전원에게 소리를 보내며 쿨다운이 따로 적용된다', (action) => {
    join('a', 'A');
    join('b', 'B');
    raw('b', 'action.perform', { action });
    expect(errCode('b')).toBe('NOT_IN_BOOTH');

    raw('a', 'booth.enter');
    raw('a', 'action.perform', { action });
    expect(last('b', 'sound.play')).toMatchObject({ payload: { action } });
    raw('a', 'action.perform', { action });
    expect(errCode('a')).toBe('COOLDOWN');
    raw('a', 'action.perform', { action: action === 'spit' ? 'phlegm' : 'spit' });
    expect(soundCount('b')).toBe(2);
  });
});

describe('비데', () => {
  it('부스 안에서만 가능하고, 전원에게 sound.play(bidet)를 보내며 4초 쿨다운이 독립적으로 적용된다', () => {
    join('a', 'A');
    join('b', 'B');
    raw('b', 'action.perform', { action: 'bidet' });
    expect(errCode('b')).toBe('NOT_IN_BOOTH');

    raw('a', 'booth.enter');
    raw('a', 'action.perform', { action: 'bidet' });
    for (const id of ['a', 'b']) {
      const m = last(id, 'sound.play');
      expect(m?.type === 'sound.play' && m.payload.action).toBe('bidet');
    }

    advance(1000);
    raw('a', 'action.perform', { action: 'bidet' });
    expect(errCode('a')).toBe('COOLDOWN');
    expect(soundCount('b')).toBe(1);

    raw('a', 'action.perform', { action: 'poop' }); // 다른 액션은 쿨다운이 따로다
    expect(soundCount('b')).toBe(2);

    advance(3100);
    pong('a');
    pong('b');
    raw('a', 'action.perform', { action: 'bidet' });
    expect(soundCount('b')).toBe(3);
  });
});
