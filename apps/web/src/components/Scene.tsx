import type { CSSProperties } from 'react';
import type { Participant, Snapshot } from '@open-toilet/protocol';
import type { Effect } from '../connection/client';

interface SceneProps {
  snapshot: Snapshot;
  selfId: string;
  /** 서버 시각 기준 현재 시각(ms) */
  serverNow: number;
  /** userId -> 말풍선 */
  bubbles: Record<string, { id: string; text: string }>;
  /** 부스 주변에 터지는 액션 효과(방귀·똥·비데) */
  effects: Effect[];
}

const POOP_COLORS = ['#4a2c12', '#5b3a1e', '#6f4518', '#7a4e24', '#8a5a2b'];
const GAS_COLORS = ['#a8b85a', '#c3cf6e', '#8fa64c', '#d4da8a'];
const WATER_COLORS = ['#74c0fc', '#a5d8ff', '#4dabf7', '#d0ebff'];

/** 효과 id로 항상 같은 난수열을 만든다. 화면이 다시 그려져도 파티클 값이 바뀌어 애니메이션이 튀지 않는다. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/** 포물선 파티클의 CSS 변수: 위로 솟았다가(--peak) 떨어져 --land 높이에 닿는다 */
function arcStyle(dx: number, peak: number, land: number, delay: number): CSSProperties {
  return { '--dx': `${dx}px`, '--peak': `${peak}px`, '--land': `${land}px`, animationDelay: `${delay}s` } as CSSProperties;
}

/** 방귀: 문 아래 틈에서 누런 가스가 뭉게뭉게 새어 나오고, 냄새 줄기가 피어오른다 */
function FartCloud({ id }: { id: string }) {
  const rand = seededRandom(id);
  const puffs = Array.from({ length: 16 }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    return {
      key: i,
      x: side * (18 + rand() * 14),
      r: 9 + rand() * 13,
      color: pick(rand, GAS_COLORS),
      dx: side * (50 + rand() * 120),
      dy: -(15 + rand() * 90),
      delay: rand() * 0.45,
    };
  });
  const stinks = [-46, 0, 46].map((x, i) => ({ key: i, x: x + (rand() - 0.5) * 16, delay: 0.25 + i * 0.15 + rand() * 0.1 }));
  return (
    <g className="fx fx--fart" transform={`translate(${CX} ${GROUND_Y - 14})`} aria-hidden="true">
      <g filter="url(#fx-gas-blur)">
        {puffs.map((p) => (
          <circle
            key={p.key}
            className="gas-puff"
            cx={p.x}
            r={p.r}
            fill={p.color}
            style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, animationDelay: `${p.delay}s` } as CSSProperties}
          />
        ))}
      </g>
      {stinks.map((s) => (
        <path
          key={s.key}
          className="stink-line"
          d={`M${s.x} -60 q8 -10 0 -20 q-8 -10 0 -20 q8 -10 0 -20`}
          style={{ animationDelay: `${s.delay}s` }}
        />
      ))}
    </g>
  );
}

/** 똥: 부스가 크게 흔들리며 충격파가 퍼지고, 덩어리가 포물선으로 튀어 바닥에 철퍼덕 붙는다 */
function PoopBurst({ id }: { id: string }) {
  const rand = seededRandom(id);
  const originY = GROUND_Y - 150;
  const chunks = Array.from({ length: 34 }, (_, i) => {
    const dx = (rand() - 0.5) * 2 * (60 + rand() * 330);
    return {
      key: i,
      r: 3 + rand() * 7,
      color: pick(rand, POOP_COLORS),
      dx,
      peak: -(60 + rand() * 170),
      land: GROUND_Y - originY + 6 + rand() * 40,
      delay: rand() * 0.12,
    };
  });
  const emojis = Array.from({ length: 6 }, (_, i) => ({
    key: i,
    dx: (i - 2.5) * 70 + (rand() - 0.5) * 40,
    peak: -(140 + rand() * 120),
    land: GROUND_Y - originY + 10 + rand() * 30,
    delay: 0.05 + rand() * 0.15,
    spin: (rand() < 0.5 ? -1 : 1) * (200 + rand() * 340),
  }));
  return (
    <g className="fx fx--poop" transform={`translate(${CX} ${originY})`} aria-hidden="true">
      <circle className="shockwave" r="24" />
      <circle className="shockwave shockwave--late" r="24" />
      {chunks.slice(0, 12).map((c) => (
        <ellipse
          key={`splat-${c.key}`}
          className="splat"
          cx={c.dx}
          cy={c.land}
          rx={c.r * 2.4}
          ry={c.r * 0.9}
          fill={c.color}
          style={{ animationDelay: `${c.delay}s` }}
        />
      ))}
      {chunks.map((c) => (
        <circle key={c.key} className="arc-particle arc-particle--poop" r={c.r} fill={c.color} style={arcStyle(c.dx, c.peak, c.land, c.delay)} />
      ))}
      {emojis.map((e) => (
        <text
          key={`e-${e.key}`}
          className="arc-particle arc-particle--poop poop-emoji"
          textAnchor="middle"
          dominantBaseline="central"
          style={{ ...arcStyle(e.dx, e.peak, e.land, e.delay), '--spin': `${e.spin}deg` } as CSSProperties}
        >
          💩
        </text>
      ))}
    </g>
  );
}

/** 비데: 지붕 위로 물줄기가 솟구치고, 물방울이 사방으로 흩어져 바닥에 물결이 생긴다 */
function BidetSpray({ id }: { id: string }) {
  const rand = seededRandom(id);
  const originY = GROUND_Y - 195; // 경광등 바로 위
  const drops = Array.from({ length: 40 }, (_, i) => ({
    key: i,
    color: pick(rand, WATER_COLORS),
    size: 2 + rand() * 2.5,
    dx: (rand() - 0.5) * 2 * (30 + rand() * 220),
    peak: -(50 + rand() * 150),
    land: GROUND_Y - originY + rand() * 30,
    // 한 번에 터지지 않고 1초 남짓 계속 뿜어져 나온다
    delay: rand() * 1.0,
  }));
  const ripples = [-150, -70, 80, 160].map((x, i) => ({
    key: i,
    x: x + (rand() - 0.5) * 40,
    delay: 0.7 + rand() * 0.6,
  }));
  return (
    <g className="fx fx--bidet" transform={`translate(${CX} ${originY})`} aria-hidden="true">
      <rect className="water-jet" x="-5" y="-150" width="10" height="150" rx="5" />
      {drops.map((d) => (
        <ellipse
          key={d.key}
          className="arc-particle arc-particle--water"
          rx={d.size}
          ry={d.size * 1.7}
          fill={d.color}
          style={arcStyle(d.dx, d.peak, d.land, d.delay)}
        />
      ))}
      {ripples.map((r) => (
        <ellipse
          key={`r-${r.key}`}
          className="ripple"
          cx={r.x}
          cy={GROUND_Y - originY + 14}
          rx="16"
          ry="4"
          style={{ animationDelay: `${r.delay}s` }}
        />
      ))}
    </g>
  );
}

/** 담배에 불이 붙어 있는 동안 환기구에서 가늘게 피어오르는 연기 */
function SmokeWisp() {
  return (
    <g className="fx smoke-wisp" transform={`translate(${VENT_X} ${VENT_Y})`} aria-hidden="true">
      <rect className="vent" x="-7" y="-4" width="14" height="10" rx="2" />
      <g filter="url(#fx-gas-blur)">
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} className="wisp" r="9" style={{ animationDelay: `${i * 0.6}s` }} />
        ))}
      </g>
    </g>
  );
}

/** 불 붙이기: 환기구에서 불똥이 튄다 */
function LightSpark({ id }: { id: string }) {
  const rand = seededRandom(id);
  const sparks = Array.from({ length: 10 }, (_, i) => ({
    key: i,
    dx: (rand() - 0.5) * 70,
    peak: -(20 + rand() * 50),
    land: 10 + rand() * 20,
    delay: rand() * 0.15,
  }));
  return (
    <g className="fx" transform={`translate(${VENT_X} ${VENT_Y})`} aria-hidden="true">
      <circle className="flame-flash" r="12" />
      {sparks.map((s) => (
        <circle key={s.key} className="arc-particle arc-particle--spark" r="2" style={arcStyle(s.dx, s.peak, s.land, s.delay)} />
      ))}
    </g>
  );
}

/** 흡입: 환기구 안쪽이 빨갛게 달아오른다 */
function PuffGlow() {
  return (
    <g className="fx" transform={`translate(${VENT_X} ${VENT_Y})`} aria-hidden="true">
      <circle className="ember-glow" r="14" />
    </g>
  );
}

/** 내뿜기: 환기구에서 굵은 연기가 뭉게뭉게 솟아 퍼진다 */
function ExhaleCloud({ id }: { id: string }) {
  const rand = seededRandom(id);
  const puffs = Array.from({ length: 14 }, (_, i) => ({
    key: i,
    r: 8 + rand() * 12,
    dx: (rand() - 0.3) * 160,
    dy: -(60 + rand() * 140),
    delay: i * 0.06 + rand() * 0.1,
  }));
  return (
    <g className="fx" transform={`translate(${VENT_X} ${VENT_Y})`} aria-hidden="true">
      <g filter="url(#fx-gas-blur)">
        {puffs.map((p) => (
          <circle
            key={p.key}
            className="smoke-puff"
            r={p.r}
            style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, animationDelay: `${p.delay}s` } as CSSProperties}
          />
        ))}
      </g>
    </g>
  );
}

/** 재 털기: 문 아래 틈으로 회색 재가 살랑살랑 떨어진다 */
function AshFall({ id }: { id: string }) {
  const rand = seededRandom(id);
  const flakes = Array.from({ length: 9 }, (_, i) => ({
    key: i,
    x: 12 + rand() * 20,
    size: 1.5 + rand() * 2,
    sway: (rand() - 0.5) * 30,
    delay: rand() * 0.4,
  }));
  return (
    <g className="fx" transform={`translate(${CX} ${GROUND_Y - 60})`} aria-hidden="true">
      {flakes.map((f) => (
        <rect
          key={f.key}
          className="ash-flake"
          x={f.x}
          width={f.size * 2}
          height={f.size}
          rx="0.6"
          style={{ '--sway': `${f.sway}px`, animationDelay: `${f.delay}s` } as CSSProperties}
        />
      ))}
    </g>
  );
}

/** 담배 끄기: 환기구에서 마지막 연기가 퐁 하고 빠져나간다 */
function SnuffPoof({ id }: { id: string }) {
  const rand = seededRandom(id);
  return (
    <g className="fx" transform={`translate(${VENT_X} ${VENT_Y})`} aria-hidden="true">
      <g filter="url(#fx-gas-blur)">
        {Array.from({ length: 6 }, (_, i) => (
          <circle
            key={i}
            className="smoke-puff"
            r={6 + rand() * 6}
            style={{ '--dx': `${(rand() - 0.5) * 60}px`, '--dy': `${-(40 + rand() * 50)}px`, animationDelay: `${0.25 + i * 0.05}s` } as CSSProperties}
          />
        ))}
      </g>
    </g>
  );
}

/** 물 내리기: 부스 바닥 아래로 물이 소용돌이치며 빨려 들어가고, 문틈으로 물방울이 튄다 */
function FlushWhirl({ id }: { id: string }) {
  const rand = seededRandom(id);
  const drops = Array.from({ length: 12 }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    return {
      key: i,
      dx: side * (30 + rand() * 90),
      peak: -(10 + rand() * 30),
      land: 14 + rand() * 18,
      delay: 0.2 + rand() * 0.6,
      color: pick(rand, WATER_COLORS),
    };
  });
  return (
    <g className="fx" transform={`translate(${CX} ${GROUND_Y + 8})`} aria-hidden="true">
      {/* 바닥에 눕힌 소용돌이 (원근 때문에 납작한 타원으로 보인다) */}
      <g transform="scale(1 0.3)">
        <circle className="whirl" r="78" />
        <circle className="whirl whirl--mid" r="52" />
        <circle className="whirl whirl--inner" r="28" />
        <circle className="whirl-core" r="14" />
      </g>
      {drops.map((d) => (
        <circle key={d.key} className="arc-particle arc-particle--water" r="2.6" fill={d.color} style={arcStyle(d.dx, d.peak, d.land, d.delay)} />
      ))}
    </g>
  );
}

/** 침·가래침: 문 아래 틈으로 튀어나와 부스 앞 바닥에 철퍽 */
function SpitShot({ id, phlegm }: { id: string; phlegm: boolean }) {
  const rand = seededRandom(id);
  const dx = (rand() - 0.5) * 120;
  const land = 34 + rand() * 20;
  const delay = phlegm ? 1.1 : 0;
  const color = phlegm ? '#a9c23f' : '#d0ebff';
  return (
    <g className="fx" transform={`translate(${CX} ${GROUND_Y - 4})`} aria-hidden="true">
      <ellipse className="splat splat--spit" cx={dx} cy={land} rx={phlegm ? 16 : 9} ry={phlegm ? 5 : 3} fill={color} style={{ animationDelay: `${delay}s` }} />
      <circle className="arc-particle arc-particle--spit" r={phlegm ? 6 : 3.5} fill={color} style={arcStyle(dx, -26, land, delay)} />
    </g>
  );
}

/** 기침: 환기구에서 연기가 콜록콜록 세 번 끊어 터져 나온다 */
function CoughPuffs({ id }: { id: string }) {
  const rand = seededRandom(id);
  return (
    <g className="fx" transform={`translate(${VENT_X} ${VENT_Y})`} aria-hidden="true">
      <g filter="url(#fx-gas-blur)">
        {[1.05, 1.4, 1.72].flatMap((at, k) =>
          Array.from({ length: 4 }, (_, i) => (
            <circle
              key={`${k}-${i}`}
              className="smoke-puff"
              r={5 + rand() * 6}
              style={{ '--dx': `${(rand() - 0.5) * 70}px`, '--dy': `${-(30 + rand() * 40)}px`, animationDelay: `${at + i * 0.03}s` } as CSSProperties}
            />
          )),
        )}
      </g>
    </g>
  );
}

/** 도넛 연기: 환기구에서 고리 모양 연기가 하나씩 떠올라 커진다 */
function SmokeRings() {
  return (
    <g className="fx" transform={`translate(${VENT_X} ${VENT_Y})`} aria-hidden="true">
      {[0.15, 0.6, 1.05].map((at) => (
        <ellipse key={at} className="smoke-ring" rx="11" ry="5" style={{ animationDelay: `${at}s` }} />
      ))}
    </g>
  );
}

function ActionEffect({ effect }: { effect: Effect }) {
  switch (effect.action) {
    case 'fart':
      return <FartCloud id={effect.id} />;
    case 'poop':
      return <PoopBurst id={effect.id} />;
    case 'bidet':
      return <BidetSpray id={effect.id} />;
    case 'flush':
      return <FlushWhirl id={effect.id} />;
    case 'light':
      return <LightSpark id={effect.id} />;
    case 'puff':
      return effect.variant === 'cough' ? (
        <>
          <PuffGlow />
          <CoughPuffs id={effect.id} />
        </>
      ) : (
        <PuffGlow />
      );
    case 'exhale':
      return effect.variant === 'ring' ? <SmokeRings /> : <ExhaleCloud id={effect.id} />;
    case 'burnout':
      return <LightSpark id={effect.id} />;
    case 'ash':
      return <AshFall id={effect.id} />;
    case 'snuff_wall':
    case 'snuff_toilet':
    case 'snuff_floor':
      return <SnuffPoof id={effect.id} />;
    case 'spit':
    case 'phlegm':
      return <SpitShot id={effect.id} phlegm={effect.action === 'phlegm'} />;
    default:
      return null; // 노크는 소리와 부스 떨림으로만 보여 준다
  }
}

const VIEW_W = 1000;
const CX = VIEW_W / 2;
const GROUND_Y = 470;

// 담배 연기는 지붕 환기구에서 새어 나온다 (부스 지붕 오른쪽 위)
const VENT_X = CX + 22;
const VENT_Y = GROUND_Y - 186;

// 부스는 아래 "도면 좌표(local)"로 그린 뒤 BOOTH_SCALE 만큼 줄여서 배치한다.
const BOOTH_TOP_LOCAL = 80; // 경광등 맨 위
const BOOTH_HEIGHT_LOCAL = GROUND_Y - BOOTH_TOP_LOCAL; // 390
const BOOTH_SCALE = 0.5; // 화면에서 부스 전체 높이 약 195px
const BOOTH_HALF_WIDTH = 80 * BOOTH_SCALE; // 받침 기준 반폭

const DOOR_GREEN = '#2f9373';
const INTERIOR = '#14402f';
const RIM = '#cfd5d2';
const RIM_DARK = '#8f9a95';
const PLASTIC = '#15171b';

/** 화장실 입구에 그려진 것 같은 남자 픽토그램 (꽉 찬 실루엣) */
function Person({
  x,
  y,
  name,
  isSelf,
  dim,
  badge,
  sub,
}: {
  x: number;
  y: number;
  name: string;
  isSelf: boolean;
  dim: boolean;
  badge?: string;
  sub?: string;
}) {
  // 꽉 찬 흰색 남자 픽토그램: 분리된 둥근 머리, 어깨에서 이어지는 팔(몸통과 가는 틈), 가운데가 벌어진 두 다리
  const fill = isSelf ? '#ffa94d' : '#f8f9fa';
  return (
    <g transform={`translate(${x} ${y})`} opacity={dim ? 0.35 : 1} fill={fill}>
      {/* 상체: 몸통 높이 38 / 폭 19 */}
      <g transform="translate(0 -11)">
        <circle cx="0" cy="-57" r="8" />
        <rect x="-15" y="-43" width="30" height="13" rx="6.5" />
        <rect x="-9.5" y="-43" width="19" height="38" rx="3" />
        <rect x="-15" y="-38" width="4.5" height="31" rx="2.2" />
        <rect x="10.5" y="-38" width="4.5" height="31" rx="2.2" />
      </g>
      {/* 다리: 몸통과 같은 폭(19), 몸통과 비슷한 길이 */}
      <rect x="-9.5" y="-20" width="8.25" height="38" rx="3.5" />
      <rect x="1.25" y="-20" width="8.25" height="38" rx="3.5" />
      <text className="person-name" y="-83" textAnchor="middle">
        {name}
      </text>
      {isSelf && (
        <text className="person-badge" y="-99" textAnchor="middle">
          나
        </text>
      )}
      {badge && (
        <text className="person-sub" y="38" textAnchor="middle">
          {badge}
        </text>
      )}
      {sub && (
        <text className="person-sub person-sub--warn" y="52" textAnchor="middle">
          {sub}
        </text>
      )}
    </g>
  );
}

/** 정면에서 본 변기 (문이 열렸을 때 바닥에 보인다) */
function Toilet() {
  const x = CX;
  const stroke = { stroke: '#8f9a95', strokeWidth: 2 };
  return (
    <g aria-hidden="true" transform={`translate(${x} 412) scale(0.5) translate(${-x} -454)`}>
      <rect x={x - 26} y="304" width="52" height="50" rx="7" fill="#e9ecef" {...stroke} />
      <rect x={x - 30} y="300" width="60" height="9" rx="4" fill="#f8f9fa" {...stroke} />
      <circle cx={x} cy="316" r="4" fill="#ced4da" {...stroke} />
      <rect x={x - 33} y="354" width="66" height="14" rx="7" fill="#f8f9fa" {...stroke} />
      <path
        d={`M${x - 28} 368 L${x + 28} 368 C${x + 28} 400 ${x + 18} 414 ${x + 14} 424 L${x - 14} 424 C${x - 18} 414 ${x - 28} 400 ${x - 28} 368 Z`}
        fill="#f1f3f5"
        {...stroke}
      />
      <rect x={x - 20} y="424" width="40" height="24" rx="4" fill="#e9ecef" {...stroke} />
      <rect x={x - 26} y="446" width="52" height="8" rx="3" fill="#dee2e6" {...stroke} />
    </g>
  );
}

/** 이동식 간이 화장실: 검은 받침, 회색 테두리, 녹색 문, 피라미드 지붕, 파란 경광등 */
function Booth({ open, busy }: { open: boolean; busy: boolean }) {
  const bodyL = CX - 62;
  const bodyR = CX + 62;
  const bodyT = 134;
  const bodyB = 428;

  return (
    <g>
      {/* 받침 */}
      <path d={`M${CX - 80} ${GROUND_Y} L${CX + 80} ${GROUND_Y} L${CX + 70} ${bodyB - 4} L${CX - 70} ${bodyB - 4} Z`} fill={PLASTIC} />
      <rect x={CX - 46} y={bodyB + 14} width="92" height="26" rx="4" fill="#23262c" />
      <rect x={CX - 40} y={bodyB + 20} width="80" height="3" fill="#3a3e46" />
      <rect x={CX - 84} y={bodyB - 4} width="8" height="22" rx="3" fill={PLASTIC} />
      <rect x={CX + 76} y={bodyB - 4} width="8" height="22" rx="3" fill={PLASTIC} />

      {/* 본체 테두리 */}
      <rect x={bodyL} y={bodyT} width={bodyR - bodyL} height={bodyB - bodyT} fill={RIM} stroke={RIM_DARK} strokeWidth="2" />

      {/* 안쪽 (문이 열렸을 때 보이는 내부) */}
      <rect x={bodyL + 8} y={bodyT + 8} width={bodyR - bodyL - 16} height={bodyB - bodyT - 16} fill={INTERIOR} />

      {open ? (
        <>
          <Toilet />
        </>
      ) : (
        <>
          <rect x={bodyL + 8} y={bodyT + 8} width={bodyR - bodyL - 16} height={bodyB - bodyT - 16} fill={DOOR_GREEN} />
          <rect
            x={bodyL + 14}
            y={bodyT + 14}
            width={bodyR - bodyL - 28}
            height={bodyB - bodyT - 28}
            fill="none"
            stroke="#5fb99b"
            strokeWidth="1.5"
          />
          <circle cx={bodyR - 26} cy="290" r="7" fill={RIM} stroke={RIM_DARK} strokeWidth="1.5" />
          <circle cx={bodyR - 26} cy="290" r="2.5" fill={RIM_DARK} />
        </>
      )}

      {/* 지붕 */}
      <polygon points={`${CX - 76},${bodyT + 2} ${CX + 76},${bodyT + 2} ${CX + 30},106 ${CX - 30},106`} fill="#3b3f47" />
      <polygon points={`${CX - 76},${bodyT + 2} ${CX - 30},106 ${CX - 30},${bodyT + 2}`} fill="#30333a" />
      <rect x={CX - 78} y={bodyT - 4} width="156" height="9" rx="2" fill="#23262c" />
      <rect x={CX - 32} y="102" width="64" height="6" rx="2" fill="#23262c" />

      {/* 열린 문은 지붕보다 앞에 그려서 지붕에 가려지지 않게 한다 */}
      {open && (
        <>
          {/* 손잡이가 오른쪽에 있으므로 경첩은 왼쪽: 문은 왼쪽으로 열리고, 바깥쪽 끝이 관람자 쪽으로 나와 더 크게 퍼진다 */}
          <polygon
            points={`${bodyL + 4},${bodyT + 6} ${bodyL - 52},${bodyT - 10} ${bodyL - 52},${bodyB + 6} ${bodyL + 4},${bodyB - 6}`}
            fill={DOOR_GREEN}
            stroke={RIM}
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <polygon
            points={`${bodyL - 6},${bodyT + 36} ${bodyL - 44},${bodyT + 24} ${bodyL - 44},${bodyB - 22} ${bodyL - 6},${bodyB - 30}`}
            fill="none"
            stroke="#5fb99b"
            strokeWidth="1.5"
          />
          <ellipse cx={bodyL - 40} cy="290" rx="4" ry="6" fill={RIM} stroke={RIM_DARK} />
        </>
      )}

      {/* 경광등 */}
      <rect x={CX - 12} y="92" width="24" height="12" rx="3" fill="#5c6068" />
      <path d={`M${CX - 11} 93 C${CX - 11} 76 ${CX + 11} 76 ${CX + 11} 93 Z`} className={busy ? 'beacon beacon--on' : 'beacon'} />
      <ellipse cx={CX - 4} cy="86" rx="3" ry="5" fill="#fff" opacity="0.45" />
    </g>
  );
}

/** 들어간 지 얼마나 지났는지 mm:ss (60분이 넘으면 분이 계속 늘어난다) */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function participantLabel(p: Participant | undefined): string {
  return p?.name ?? '?';
}

/** 이름이 차지하는 대략적인 가로 폭(px). 한글·한자·이모지는 넓게, 영문·숫자는 좁게 센다. */
function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += (ch.codePointAt(0) ?? 0) > 0x2e7f ? 15.5 : 8.6;
  return width;
}

/** 사람 한 명이 차지하는 가로 폭: 이름이 전부 보이도록 이름 폭을 기준으로 한다. */
function slotWidth(name: string): number {
  return Math.max(70, textWidth(name) + 18);
}

interface Placed<T> {
  item: T;
  x: number;
  row: number;
}

/** 폭을 고려해 줄바꿈하며 배치한다. 이름이 길수록 간격이 넓어져 서로 가려지지 않는다. */
function flowLayout<T>(
  items: T[],
  widthOf: (item: T) => number,
  left: number,
  right: number,
  align: 'left' | 'center',
): { placed: Placed<T>[]; rows: number } {
  const rows: T[][] = [[]];
  let used = 0;
  for (const item of items) {
    const w = widthOf(item);
    if (used + w > right - left && rows[rows.length - 1].length > 0) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1].push(item);
    used += w;
  }
  const placed: Placed<T>[] = [];
  rows.forEach((row, rowIndex) => {
    const total = row.reduce((sum, item) => sum + widthOf(item), 0);
    let cursor = align === 'center' ? left + (right - left - total) / 2 : left;
    for (const item of row) {
      const w = widthOf(item);
      placed.push({ item, x: cursor + w / 2, row: rowIndex });
      cursor += w;
    }
  });
  return { placed, rows: items.length === 0 ? 0 : rows.length };
}

/** 말풍선: 앵커(머리 위) 바로 위에 아래쪽 꼬리가 앵커를 향하도록 그린다. */
function Bubble({ x, y, text }: { x: number; y: number; text: string }) {
  const height = 120;
  return (
    <foreignObject x={x - 130} y={y - height} width="260" height={height} className="bubble-layer">
      <div className="bubble-wrap">
        <div className="bubble" role="status">
          {text}
        </div>
      </div>
    </foreignObject>
  );
}

const QUEUE_ROW_GAP = 140;
const IDLE_ROW_GAP = 110;

export function Scene({ snapshot, selfId, serverNow, bubbles, effects }: SceneProps) {
  const byId = new Map(snapshot.participants.map((p) => [p.userId, p]));
  const occupant = snapshot.booth.occupantId ? byId.get(snapshot.booth.occupantId) : undefined;
  const open = !snapshot.booth.occupantId;

  const queued = new Set(snapshot.queue);
  const idle = snapshot.participants.filter((p) => p.userId !== snapshot.booth.occupantId && !queued.has(p.userId));

  // 대기열: 부스 오른쪽에서 이름 폭만큼 간격을 벌리고, 공간이 모자라면 다음 줄로 내린다
  const queueItems = snapshot.queue.map((userId, index) => ({ userId, index, p: byId.get(userId) }));
  const queueLayout = flowLayout(
    queueItems,
    (q) => slotWidth(participantLabel(q.p)),
    CX + BOOTH_HALF_WIDTH + 50,
    VIEW_W - 16,
    'left',
  );
  const queueBottomRow = Math.max(0, queueLayout.rows - 1);

  // 나머지 접속자: 아래쪽에 가운데 정렬. 대기열이 여러 줄이면 그 아래로 내린다
  const idleBaseY = GROUND_Y + 8 + (queueBottomRow > 0 ? queueBottomRow * QUEUE_ROW_GAP : 0) + 150;
  const idleLayout = flowLayout(idle, (p) => slotWidth(p.name), 16, VIEW_W - 16, 'center');

  const lastQueueY = GROUND_Y + 8 + queueBottomRow * QUEUE_ROW_GAP;
  const lastIdleY = idleBaseY + Math.max(0, idleLayout.rows - 1) * IDLE_ROW_GAP;
  const viewH = Math.max(640, (idle.length > 0 ? lastIdleY : lastQueueY) + 90);

  // 부스 이름표는 두 줄: 이름(전부 표시) / 상태·타이머. 이름이 길어도 타이머가 가려지지 않는다
  let tagName: string | null = null;
  let tagSub: string | null = null;
  let tagClass = 'tag';
  if (occupant) {
    const since = snapshot.booth.occupiedSince;
    tagName = occupant.name;
    tagSub = [since === null ? null : formatElapsed(serverNow - since), occupant.status === 'disconnected' ? '연결 끊김' : null]
      .filter(Boolean)
      .join(' · ');
    tagClass += ' tag--busy';
  } else if (snapshot.priority) {
    const target = byId.get(snapshot.priority.userId);
    const left = Math.max(0, Math.ceil((snapshot.priority.expiresAt - serverNow) / 1000));
    tagName = `${participantLabel(target)}님`;
    tagSub = `우선 입장 · ${left}초`;
    tagClass += ' tag--reserved';
  }

  const label = occupant
    ? `부스 사용 중: ${occupant.name}, ${formatElapsed(serverNow - (snapshot.booth.occupiedSince ?? serverNow))} 경과`
    : snapshot.priority
      ? `부스 비어 있음, ${participantLabel(byId.get(snapshot.priority.userId))}님 우선 입장 중`
      : '부스 비어 있음';

  const boothTopY = GROUND_Y - BOOTH_HEIGHT_LOCAL * BOOTH_SCALE;
  const tagBoxY = boothTopY - 70;

  // 말풍선은 모든 사람 위에 겹쳐 그리려고 마지막에 따로 그린다
  const bubbleNodes: { key: string; x: number; y: number; text: string }[] = [];
  const addBubble = (userId: string, x: number, y: number) => {
    const bubble = bubbles[userId];
    if (bubble) bubbleNodes.push({ key: `${userId}:${bubble.id}`, x, y, text: bubble.text });
  };

  if (occupant) addBubble(occupant.userId, CX, tagBoxY - 4);

  // 똥은 부스와 화면이 크게 흔들리고, 방귀·비데·노크·물 내리기는 부스만 살짝 떨린다
  const quake = effects.some((e) => e.action === 'poop');
  const wobble = effects.some((e) => ['fart', 'bidet', 'knock', 'flush', 'wipe', 'burnout'].includes(e.action) || e.variant === 'cough');
  const shake = quake ? 'booth-shake booth-shake--hard' : wobble ? 'booth-shake' : undefined;

  return (
    <svg
      className={quake ? 'scene scene--quake' : 'scene'}
      viewBox={`0 60 ${VIEW_W} ${viewH - 60}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${label}. 접속자 ${snapshot.participants.length}명, 대기 ${snapshot.queue.length}명`}
    >
      <defs>
        <filter id="fx-gas-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
      </defs>

      {/* CSS 흔들림은 transform 속성이 없는 바깥 g에 걸어야 배치 transform을 덮어쓰지 않는다 */}
      <g className={shake}>
        <g transform={`translate(${CX} ${GROUND_Y}) scale(${BOOTH_SCALE}) translate(${-CX} ${-GROUND_Y})`}>
          <Booth open={open} busy={!open} />
        </g>
      </g>

      {/* 부스 위 이름표 */}
      {tagName && (
        <foreignObject x={CX - 260} y={tagBoxY} width="520" height="64">
          <div className="tag-box">
            <div className={tagClass}>
              <span className="tag-name">{tagName}</span>
              {tagSub && <span className="tag-sub">{tagSub}</span>}
            </div>
          </div>
        </foreignObject>
      )}

      {/* 연기·효과는 이름표 위로 피어올라야 가려지지 않는다 */}
      {snapshot.booth.cigarette?.litAt != null && <SmokeWisp />}

      {effects.map((effect) => (
        <ActionEffect key={effect.id} effect={effect} />
      ))}

      {/* 대기열 */}
      {queueLayout.placed.map(({ item, x, row }) => {
        const y = GROUND_Y + 8 + row * QUEUE_ROW_GAP;
        addBubble(item.userId, x, y - 112);
        const isPriority = snapshot.priority?.userId === item.userId;
        return (
          <Person
            key={item.userId}
            x={x}
            y={y}
            name={participantLabel(item.p)}
            isSelf={item.userId === selfId}
            dim={item.p?.status === 'disconnected'}
            badge={isPriority ? '입장 차례!' : `${item.index + 1}번`}
            sub={item.p?.status === 'disconnected' ? '연결 끊김' : undefined}
          />
        );
      })}

      {/* 부스 사용자는 문 뒤에 있으므로 따로 그리지 않는다 */}
      {idleLayout.placed.map(({ item, x, row }) => {
        const y = idleBaseY + row * IDLE_ROW_GAP;
        addBubble(item.userId, x, y - 112);
        return (
          <Person
            key={item.userId}
            x={x}
            y={y}
            name={item.name}
            isSelf={item.userId === selfId}
            dim={item.status === 'disconnected'}
            sub={item.status === 'disconnected' ? '연결 끊김' : undefined}
          />
        );
      })}

      {bubbleNodes.map((b) => (
        <Bubble key={b.key} x={b.x} y={b.y} text={b.text} />
      ))}
    </svg>
  );
}
