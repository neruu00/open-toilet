import { memo } from 'react';

// 1인칭 화면의 그림들. 좌표는 모두 viewBox 1000 x 700 기준이다.
// 무거운 필터(얼룩·질감·손글씨 번짐)는 움직이지 않는 배경(StallBackdrop)에만 쓰고,
// 배경은 별도 SVG 레이어로 한 번만 그려지게 해서 연기·파티클이 움직여도 다시 계산되지 않게 한다.

export const DOOR = { x: 330, y: 100, w: 340, h: 486 };
export const FLOOR_Y = 600;

// 담배를 든 손의 위치와 담배 기울기 (오른쪽 아래 버튼들에 가리지 않게 무릎 위쪽에 둔다)
export const HAND_X = 660;
export const HAND_Y = 520;
export const CIG_ANGLE = 25;
export const FILTER = 34;
/** 필터를 뺀 담뱃잎 부분의 길이 */
export const TOBACCO = 96;
/** 재는 이 길이 넘게는 매달리지 않는다 (그 이상은 처진다) */
export const ASH_MAX = 34;

/** 휴지 롤 아래쪽 (닦기 연출이 여기서 휴지를 뜯는다) */
export const ROLL_SPOT = { x: 884, y: 470 };

/** id로 항상 같은 난수열을 만든다. 다시 그려도 모양이 바뀌지 않게 한다 */
export function seededRandom(seed: string): () => number {
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

// ---------- 배경: 낡은 칸막이 ----------

/** 모서리 거미줄. (x, y)에서 from~to 각도로 퍼진다 (0도 = 오른쪽, 90도 = 아래) */
function Cobweb({ x, y, radius, from, to, seed }: { x: number; y: number; radius: number; from: number; to: number; seed: string }) {
  const rand = seededRandom(seed);
  const spokes = 8;
  const rings = 7;
  const angles = Array.from({ length: spokes }, (_, i) => from + ((to - from) * i) / (spokes - 1) + (rand() - 0.5) * 6);
  const point = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return [x + Math.cos(rad) * r, y + Math.sin(rad) * r] as const;
  };
  const threads: string[] = [];
  for (const a of angles) {
    const [ex, ey] = point(a, radius * (0.85 + rand() * 0.25));
    threads.push(`M${x} ${y} L${ex.toFixed(1)} ${ey.toFixed(1)}`);
  }
  for (let k = 1; k <= rings; k++) {
    const r = radius * Math.pow(k / rings, 0.9);
    for (let i = 0; i < spokes - 1; i++) {
      if (rand() < 0.14) continue; // 군데군데 끊어진 실
      const [x1, y1] = point(angles[i], r * (0.94 + rand() * 0.1));
      const [x2, y2] = point(angles[i + 1], r * (0.94 + rand() * 0.1));
      const [cx, cy] = point((angles[i] + angles[i + 1]) / 2, r * 0.8); // 가운데가 안쪽으로 처진다
      threads.push(`M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    }
  }
  // 늘어진 실 몇 가닥
  for (let i = 0; i < 3; i++) {
    const [sx, sy] = point(angles[1 + Math.floor(rand() * (spokes - 2))], radius * (0.4 + rand() * 0.5));
    threads.push(`M${sx.toFixed(1)} ${sy.toFixed(1)} q${(rand() * 10 - 5).toFixed(1)} ${(14 + rand() * 18).toFixed(1)} ${(rand() * 6 - 3).toFixed(1)} ${(30 + rand() * 30).toFixed(1)}`);
  }
  return (
    <g fill="none" stroke="#dfe5e1" strokeLinecap="round">
      <path d={threads.join(' ')} strokeWidth="0.8" opacity="0.32" />
      {/* 먼지가 엉겨 붙은 부분 */}
      <circle cx={point(angles[3], radius * 0.35)[0]} cy={point(angles[3], radius * 0.35)[1]} r="5" fill="#c8cec9" stroke="none" opacity="0.12" />
    </g>
  );
}

/** 문에 남은 긁힌 자국들 */
function Scratches({ seed, count, area }: { seed: string; count: number; area: { x: number; y: number; w: number; h: number } }) {
  const rand = seededRandom(seed);
  const d = Array.from({ length: count }, () => {
    const x = area.x + rand() * area.w;
    const y = area.y + rand() * area.h;
    const len = 8 + rand() * 36;
    const a = (rand() - 0.5) * 1.6;
    return `M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(a) * len).toFixed(1)} ${(Math.sin(a) * len).toFixed(1)}`;
  }).join(' ');
  return <path d={d} stroke="#d8efe4" strokeWidth="0.9" strokeLinecap="round" opacity="0.18" fill="none" />;
}

/** 손으로 쓴 낙서 한 줄 */
function Scrawl({
  x,
  y,
  rotate,
  size,
  color,
  opacity = 0.85,
  weight = 400,
  children,
}: {
  x: number;
  y: number;
  rotate: number;
  size: number;
  color: string;
  opacity?: number;
  weight?: number;
  children: string;
}) {
  return (
    <text
      x={x}
      y={y}
      transform={`rotate(${rotate} ${x} ${y})`}
      className="fp-scrawl"
      fontSize={size}
      fontWeight={weight}
      fill={color}
      opacity={opacity}
    >
      {children}
    </text>
  );
}

/** 칸막이 안쪽: 천장·양옆 벽·바닥·닫힌 문. 움직이지 않는 부분만 그린다 */
export const StallBackdrop = memo(function StallBackdrop({ knocking }: { knocking: boolean }) {
  const lockX = DOOR.x + DOOR.w - 72;
  return (
    <g>
      <defs>
        {/* 고운 먼지 알갱이 */}
        <filter id="fpb-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 -0.38" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        {/* 누렇게 번진 얼룩 (세로로 길게 흘러내린 모양) */}
        <filter id="fpb-stain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.004" numOctaves="4" seed="11" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.26  0 0 0 0 0.2  0 0 0 0 0.1  3.2 0 0 0 -1.75" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        {/* 시커먼 때 (아래쪽·구석에 많다) */}
        <filter id="fpb-grime" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="21" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.04  0 0 0 0 0.05  0 0 0 0 0.04  0 2.4 0 0 -1.05" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        {/* 손글씨가 살짝 떨리고 번진 느낌 */}
        <filter id="fpb-ink" x="-5%" y="-20%" width="110%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="5" result="wobble" />
          <feDisplacementMap in="SourceGraphic" in2="wobble" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="shaky" />
          <feGaussianBlur in="shaky" stdDeviation="0.35" />
        </filter>

        <linearGradient id="fpb-ceiling" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a1410" />
          <stop offset="1" stopColor="#18261f" />
        </linearGradient>
        <linearGradient id="fpb-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#365a4a" />
          <stop offset="0.55" stopColor="#2a4639" />
          <stop offset="1" stopColor="#1b2d25" />
        </linearGradient>
        <linearGradient id="fpb-left" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0c1612" />
          <stop offset="1" stopColor="#24392f" />
        </linearGradient>
        <linearGradient id="fpb-right" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#0c1612" />
          <stop offset="1" stopColor="#263d32" />
        </linearGradient>
        <linearGradient id="fpb-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b302b" />
          <stop offset="1" stopColor="#151a17" />
        </linearGradient>
        <linearGradient id="fpb-door" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4d8f74" />
          <stop offset="0.5" stopColor="#3d7a61" />
          <stop offset="1" stopColor="#2c5c48" />
        </linearGradient>
        <linearGradient id="fpb-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9ecef" />
          <stop offset="0.45" stopColor="#adb5bd" />
          <stop offset="0.55" stopColor="#868e96" />
          <stop offset="1" stopColor="#ced4da" />
        </linearGradient>
        <linearGradient id="fpb-roll" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#ece9e1" />
          <stop offset="1" stopColor="#bdb8aa" />
        </linearGradient>
        {/* 천장 형광등에서 떨어지는 빛 */}
        <radialGradient id="fpb-light" cx="0.5" cy="0.02" r="0.95">
          <stop offset="0" stopColor="#fff7d6" stopOpacity="0.22" />
          <stop offset="0.45" stopColor="#fff7d6" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </radialGradient>
        <linearGradient id="fpb-drip" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b5a32" stopOpacity="0.5" />
          <stop offset="1" stopColor="#6b5a32" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 천장 */}
      <polygon points="0,0 1000,0 800,70 200,70" fill="url(#fpb-ceiling)" />
      {/* 천장 환기구 */}
      <g transform="translate(640 20)">
        <rect x="-34" y="-9" width="68" height="18" rx="2" fill="#2b3530" stroke="#4a5650" />
        {[-24, -16, -8, 0, 8, 16, 24].map((dx) => (
          <rect key={dx} x={dx - 2} y="-6" width="3" height="12" fill="#121816" />
        ))}
      </g>

      {/* 양옆 칸막이 벽 */}
      <polygon points="0,0 200,70 200,600 0,700" fill="url(#fpb-left)" />
      <polygon points="1000,0 800,70 800,600 1000,700" fill="url(#fpb-right)" />

      {/* 바닥 타일 */}
      <polygon points="0,700 200,600 800,600 1000,700" fill="url(#fpb-floor)" />
      {[1, 2, 3].map((i) => (
        <line key={`h${i}`} x1={200 - i * 66} y1={600 + i * 33} x2={800 + i * 66} y2={600 + i * 33} stroke="#0e1210" strokeWidth="2.5" />
      ))}
      {[-3, -2, -1, 0, 1, 2, 3].map((i) => (
        <line key={`v${i}`} x1={500 + i * 100} y1="600" x2={500 + i * 167} y2="700" stroke="#0e1210" strokeWidth="2.5" />
      ))}
      {/* 바닥 물 고인 자국과 구겨진 휴지, 오래된 꽁초 */}
      <ellipse cx="770" cy="668" rx="70" ry="12" fill="#5c7a73" opacity="0.18" />
      <ellipse cx="760" cy="664" rx="34" ry="4" fill="#cfe3dc" opacity="0.12" />
      <path d="M842 650 c-6 -10 4 -18 12 -14 c6 -8 18 -4 18 4 c10 2 8 16 -2 18 c-4 8 -18 6 -20 0 c-8 0 -12 -4 -8 -8 Z" fill="#e6e2d6" />
      <path d="M850 652 c4 -2 8 0 10 4 M862 644 c2 4 0 8 -4 10" stroke="#a9a493" strokeWidth="1.2" fill="none" />
      <g transform="translate(250 650) rotate(-12)">
        <rect x="-10" y="-3" width="9" height="6" rx="1.5" fill="#c4772d" />
        <rect x="-1" y="-3" width="8" height="6" fill="#d9d4c7" />
        <rect x="6" y="-3" width="3" height="6" fill="#3b2a1d" />
      </g>

      {/* 뒷벽과 모서리 금속 몰딩 */}
      <rect x="200" y="70" width="600" height="530" fill="url(#fpb-back)" />
      <rect x="196" y="70" width="6" height="530" fill="url(#fpb-metal)" opacity="0.55" />
      <rect x="798" y="70" width="6" height="530" fill="url(#fpb-metal)" opacity="0.55" />
      <rect x="200" y="68" width="600" height="5" fill="url(#fpb-metal)" opacity="0.5" />

      {/* 환기구 아래로 흘러내린 물 자국 */}
      {[
        [616, 76, 10, 120],
        [636, 76, 6, 190],
        [660, 76, 12, 90],
      ].map(([x, y, w, h]) => (
        <rect key={x} x={x} y={y} width={w} height={h} rx={w / 2} fill="url(#fpb-drip)" />
      ))}

      {/* 왼쪽 벽: 누렇게 바랜 금연 표지판 (한쪽 귀퉁이가 들려 있다) */}
      <g transform="translate(105 270) skewY(16)">
        <rect x="-46" y="-52" width="92" height="104" rx="4" fill="#e7e1cf" />
        <rect x="-46" y="-52" width="92" height="104" rx="4" fill="#8a7b4f" opacity="0.15" />
        <circle cx="0" cy="-14" r="24" fill="none" stroke="#b32a2a" strokeWidth="6" />
        <line x1="-17" y1="3" x2="17" y2="-31" stroke="#b32a2a" strokeWidth="6" />
        <rect x="-18" y="-17" width="30" height="7" rx="1" fill="#4a4a4a" />
        <text y="38" textAnchor="middle" fontSize="20" fontWeight="800" fill="#a32424">
          금연
        </text>
        <path d="M46 -52 L46 -30 L26 -52 Z" fill="#1d2e26" />
        <path d="M46 -30 L26 -52 L30 -34 Z" fill="#d6cfb9" />
        {/* 표지판 위에 지진 담배 자국 */}
        <circle cx="-28" cy="30" r="5" fill="#2a1d12" opacity="0.8" />
        <circle cx="-28" cy="30" r="9" fill="#2a1d12" opacity="0.18" />
      </g>
      <g filter="url(#fpb-ink)">
        <Scrawl x={60} y={420} rotate={12} size={22} color="#d8d2bf" opacity={0.45}>
          누가 휴지 다 씀??
        </Scrawl>
        <Scrawl x={70} y={500} rotate={18} size={18} color="#111" opacity={0.6}>
          여긴 금연이라고
        </Scrawl>
      </g>

      {/* 오른쪽 벽: 휴지걸이와 롤 */}
      <g transform="translate(895 430) skewY(-16)">
        <rect x="-46" y="-30" width="92" height="10" rx="3" fill="url(#fpb-metal)" />
        <rect x="-44" y="-22" width="6" height="22" rx="2" fill="#868e96" />
        <rect x="38" y="-22" width="6" height="22" rx="2" fill="#868e96" />
        <rect x="-36" y="-20" width="72" height="50" rx="24" fill="url(#fpb-roll)" />
        <ellipse cx="-36" cy="5" rx="7" ry="25" fill="#d8d3c5" />
        <ellipse cx="-36" cy="5" rx="3" ry="9" fill="#8b7d62" />
        {/* 늘어진 한 칸 (점선이 절취선) */}
        <path d="M-26 26 L-26 64 Q-14 70 -2 64 L-2 26 Z" fill="#f4f2ec" />
        <line x1="-26" y1="46" x2="-2" y2="46" stroke="#c9c4b6" strokeWidth="1" strokeDasharray="2 2" />
      </g>
      <g filter="url(#fpb-ink)">
        <Scrawl x={840} y={560} rotate={-14} size={20} color="#e8e2d0" opacity={0.4}>
          휴지 아껴써
        </Scrawl>
      </g>

      {/* 문 */}
      <g className={knocking ? 'fp-door fp-door--knock' : 'fp-door'}>
        {/* 알루미늄 문틀 */}
        <rect x={DOOR.x - 12} y={DOOR.y - 12} width={DOOR.w + 24} height={DOOR.h + 12} fill="url(#fpb-metal)" />
        <rect x={DOOR.x - 12} y={DOOR.y - 12} width={DOOR.w + 24} height={DOOR.h + 12} fill="#000" opacity="0.25" />
        <rect x={DOOR.x} y={DOOR.y} width={DOOR.w} height={DOOR.h} fill="url(#fpb-door)" />
        {/* 문짝 가장자리 그림자 (살짝 들어가 보이게) */}
        <rect x={DOOR.x} y={DOOR.y} width={DOOR.w} height={DOOR.h} fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="6" />
        <rect x={DOOR.x + 4} y={DOOR.y + 4} width={DOOR.w - 8} height={DOOR.h - 8} fill="none" stroke="#9fd6bf" strokeOpacity="0.15" strokeWidth="1.5" />
        <Scratches seed="door" count={46} area={{ x: DOOR.x + 10, y: DOOR.y + 20, w: DOOR.w - 20, h: DOOR.h - 40 }} />
        {/* 발로 찬 자국 */}
        <ellipse cx={DOOR.x + 120} cy={DOOR.y + DOOR.h - 40} rx="26" ry="12" fill="#0d1a14" opacity="0.35" />
        <ellipse cx={DOOR.x + 220} cy={DOOR.y + DOOR.h - 30} rx="18" ry="9" fill="#0d1a14" opacity="0.28" />

        {/* 경첩 (안쪽에서 보이는 왼쪽) */}
        {[DOOR.y + 50, DOOR.y + DOOR.h - 80].map((hy) => (
          <g key={hy}>
            <rect x={DOOR.x - 4} y={hy} width="16" height="46" rx="2" fill="url(#fpb-metal)" />
            <rect x={DOOR.x - 4} y={hy} width="16" height="46" rx="2" fill="#7a4520" opacity="0.35" />
            <circle cx={DOOR.x + 4} cy={hy + 10} r="2" fill="#5a3418" />
            <circle cx={DOOR.x + 4} cy={hy + 36} r="2" fill="#5a3418" />
          </g>
        ))}

        {/* 옷걸이 */}
        <ellipse cx="500" cy="150" rx="12" ry="8" fill="#000" opacity="0.25" />
        <circle cx="500" cy="128" r="8" fill="url(#fpb-metal)" />
        <path d="M500 130 v16 q0 16 -16 16 q-6 0 -6 -6" fill="none" stroke="url(#fpb-metal)" strokeWidth="6" strokeLinecap="round" />

        {/* 청소 점검표 (테이프로 붙여 둔 종이) */}
        <g transform="translate(560 150) rotate(3)">
          <rect x="0" y="0" width="74" height="92" fill="#ece8dc" />
          <rect x="0" y="0" width="74" height="92" fill="#8a7b4f" opacity="0.12" />
          <text x="37" y="14" textAnchor="middle" fontSize="9" fontWeight="700" fill="#3d3d3d">
            청소 점검표
          </text>
          {[24, 36, 48, 60, 72, 84].map((ly) => (
            <line key={ly} x1="6" y1={ly} x2="68" y2={ly} stroke="#9e9a8e" strokeWidth="0.7" />
          ))}
          <path d="M10 30 l3 3 l6 -7 M10 42 l3 3 l6 -7" stroke="#364fc7" strokeWidth="1.2" fill="none" />
          <rect x="-6" y="-4" width="20" height="9" fill="#f5f0c8" opacity="0.6" transform="rotate(-20)" />
          <rect x="62" y="84" width="20" height="9" fill="#f5f0c8" opacity="0.6" transform="rotate(-20 72 88)" />
        </g>
        {/* 떼어 낸 스티커 자국 */}
        <rect x="372" y="380" width="54" height="30" rx="3" fill="#cfd9c8" opacity="0.12" transform="rotate(-5 399 395)" />

        {/* 잠금장치: 금속판 + 빨간 '사용중' 창 */}
        <rect x={lockX} y="314" width="54" height="40" rx="5" fill="url(#fpb-metal)" />
        <rect x={lockX} y="314" width="54" height="40" rx="5" fill="#000" opacity="0.12" />
        <rect x={lockX + 6} y="322" width="42" height="22" rx="3" fill="#b3201f" />
        <rect x={lockX + 6} y="322" width="42" height="8" rx="3" fill="#fff" opacity="0.15" />
        <text x={lockX + 27} y="338" textAnchor="middle" fontSize="11" fontWeight="800" fill="#ffe3e3">
          사용중
        </text>
        <circle cx={lockX + 4} cy="318" r="1.6" fill="#495057" />
        <circle cx={lockX + 50} cy="350" r="1.6" fill="#495057" />

        {/* 낙서: 매직·볼펜·긁은 자국 */}
        <g filter="url(#fpb-ink)">
          <Scrawl x={356} y={236} rotate={-7} size={34} color="#141414" weight={700}>
            여기 다녀감 ✌
          </Scrawl>
          <Scrawl x={372} y={262} rotate={-6} size={18} color="#141414" opacity={0.7}>
            2019. 7. 3 새벽
          </Scrawl>
          {/* 하트 낙서 */}
          <path
            d="M430 312 c-18 -22 -46 -4 -30 18 c8 12 22 20 30 30 c8 -10 22 -18 30 -30 c16 -22 -12 -40 -30 -18 Z"
            fill="none"
            stroke="#d6336c"
            strokeWidth="2.4"
            opacity="0.8"
          />
          <Scrawl x={408} y={334} rotate={-4} size={17} color="#d6336c" opacity={0.85}>
            민수♥지은
          </Scrawl>
          {/* 바를 정(正)자로 센 날짜 */}
          <Scrawl x={556} y={276} rotate={-2} size={26} color="#3b5bdb" opacity={0.75}>
            正正正丅
          </Scrawl>
          <Scrawl x={560} y={298} rotate={-2} size={15} color="#3b5bdb" opacity={0.7}>
            변비 탈출까지
          </Scrawl>
          <Scrawl x={500} y={462} rotate={5} size={28} color="#c92a2a" weight={700}>
            휴지 확인하고 앉아라!!!
          </Scrawl>
          <path d="M504 472 q60 8 120 -2 q40 -6 70 4" fill="none" stroke="#c92a2a" strokeWidth="2.2" opacity="0.8" />
          {/* 웃는 똥 그림 */}
          <g transform="translate(640 232) rotate(8)" stroke="#141414" strokeWidth="2.2" fill="none" opacity="0.75">
            <path d="M-18 14 q18 8 36 0 q4 -10 -6 -14 q4 -10 -8 -14 q0 -8 -8 -10 q-2 6 -8 8 q-12 2 -8 14 q-12 4 -6 14 Z" />
            <circle cx="-5" cy="2" r="1.6" fill="#141414" />
            <circle cx="6" cy="2" r="1.6" fill="#141414" />
            <path d="M-6 8 q6 5 12 0" />
          </g>
          <Scrawl x={578} y={548} rotate={8} size={22} color="#141414" opacity={0.7}>
            ↓ 진짜 급했다
          </Scrawl>
        </g>
        {/* 열쇠로 긁어 쓴 글씨는 페인트가 벗겨져 밝게 보인다 */}
        <Scrawl x={372} y={548} rotate={-3} size={26} color="#cfeee0" opacity={0.35}>
          ㅋㅋㅋㅋㅋ
        </Scrawl>
      </g>

      {/* 얼룩·때·먼지를 전체에 덮는다 */}
      <rect width="1000" height="700" fill="#000" filter="url(#fpb-stain)" opacity="0.45" />
      <rect y="380" width="1000" height="320" fill="#000" filter="url(#fpb-grime)" opacity="0.35" />
      <rect width="1000" height="700" fill="#000" filter="url(#fpb-grain)" />

      {/* 구석마다 거미줄 */}
      <Cobweb x={200} y={70} radius={96} from={-5} to={200} seed="web-left" />
      <Cobweb x={800} y={70} radius={72} from={-20} to={185} seed="web-right" />
      <Cobweb x={0} y={0} radius={120} from={2} to={88} seed="web-corner" />

      {/* 형광등 빛이 위에서 떨어지고 구석은 어둡다 */}
      <rect width="1000" height="700" fill="url(#fpb-light)" />
    </g>
  );
});

// ---------- 앞쪽: 다리·손·담배 ----------

/** 앞쪽 레이어(움직이는 것들)가 쓰는 그라데이션과 무늬 */
export function ForegroundDefs() {
  return (
    <>
      <linearGradient id="fp-skin" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f2c8a4" />
        <stop offset="0.55" stopColor="#dca17a" />
        <stop offset="1" stopColor="#b47652" />
      </linearGradient>
      <linearGradient id="fp-skin-side" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#b47652" />
        <stop offset="0.35" stopColor="#dca17a" />
        <stop offset="0.7" stopColor="#ecbf9c" />
        <stop offset="1" stopColor="#c48660" />
      </linearGradient>
      <radialGradient id="fp-knee" cx="0.5" cy="0.35" r="0.6">
        <stop offset="0" stopColor="#f6d3b5" />
        <stop offset="0.7" stopColor="#dca17a" />
        <stop offset="1" stopColor="#b47652" />
      </radialGradient>
      <linearGradient id="fp-denim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4a6fa5" />
        <stop offset="0.5" stopColor="#35527d" />
        <stop offset="1" stopColor="#1f3350" />
      </linearGradient>
      <linearGradient id="fp-sleeve" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3d4148" />
        <stop offset="1" stopColor="#1f2226" />
      </linearGradient>
      {/* 담배: 원통처럼 위는 밝고 아래는 어둡다 */}
      <linearGradient id="fp-cyl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
        <stop offset="0.35" stopColor="#fff" stopOpacity="0" />
        <stop offset="0.7" stopColor="#000" stopOpacity="0.05" />
        <stop offset="1" stopColor="#000" stopOpacity="0.35" />
      </linearGradient>
      <pattern id="fp-cork" width="5" height="5" patternUnits="userSpaceOnUse">
        <rect width="5" height="5" fill="#d9822b" />
        <circle cx="1" cy="1.2" r="0.8" fill="#f3b766" />
        <circle cx="3.6" cy="3.4" r="0.7" fill="#a95b19" />
        <circle cx="3.8" cy="0.8" r="0.5" fill="#f3b766" />
      </pattern>
      <linearGradient id="fp-ash" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#dee2e6" />
        <stop offset="0.5" stopColor="#adb5bd" />
        <stop offset="1" stopColor="#6c757d" />
      </linearGradient>
      <radialGradient id="fp-ember-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fff3bf" stopOpacity="0.9" />
        <stop offset="0.35" stopColor="#ff922b" stopOpacity="0.6" />
        <stop offset="1" stopColor="#c92a2a" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="fp-metal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f1f3f5" />
        <stop offset="0.5" stopColor="#868e96" />
        <stop offset="1" stopColor="#ced4da" />
      </linearGradient>
      <linearGradient id="fp-paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#d9d4c7" />
      </linearGradient>
      <filter id="fp-ring-blur" x="-40%" y="-80%" width="180%" height="260%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
      <filter id="fp-soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="6" />
        <feOffset dx="4" dy="8" result="blur" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.45" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </>
  );
}

/** 내려다보이는 내 다리: 허벅지와 무릎, 발목까지 내린 청바지, 운동화 */
export function Legs({ shake }: { shake: boolean }) {
  return (
    <g className={shake ? 'fp-legs fp-legs--shake' : 'fp-legs'}>
      {/* 운동화 코 */}
      {[
        [300, 604, -1],
        [700, 604, 1],
      ].map(([x, y, s]) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${s} 1)`}>
          <path d="M-34 6 C -34 -10 -10 -16 18 -12 C 34 -10 40 0 36 10 Z" fill="#e9ecef" />
          <path d="M-34 6 L36 10 L36 14 L-34 12 Z" fill="#adb5bd" />
          <path d="M-8 -10 l14 2 M-4 -4 l14 2" stroke="#868e96" strokeWidth="1.4" />
        </g>
      ))}
      {/* 발목까지 내려 구겨진 청바지 */}
      <path d="M296 574 C 330 560 430 560 456 574 L 462 612 C 420 620 340 620 300 612 Z" fill="url(#fp-denim)" />
      <path d="M544 574 C 570 560 670 560 704 574 L 700 612 C 660 620 580 620 538 612 Z" fill="url(#fp-denim)" />
      <path
        d="M310 584 q30 8 60 0 q30 -8 70 4 M318 600 q40 6 80 -2 M560 584 q30 8 60 0 q30 -8 70 4 M566 600 q40 6 80 -2"
        stroke="#1a2a44"
        strokeWidth="2"
        fill="none"
        opacity="0.7"
      />
      <path d="M302 606 q78 10 156 0 M542 606 q78 10 156 0" stroke="#d9a441" strokeWidth="1" strokeDasharray="3 3" fill="none" opacity="0.7" />
      {/* 허벅지 사이 그늘 */}
      <path d="M470 700 Q 500 640 530 700 Z" fill="#000" opacity="0.5" />
      {/* 허벅지 */}
      <path d="M140 700 C 220 670 300 640 340 622 C 380 606 440 612 470 640 C 486 660 492 684 494 700 Z" fill="url(#fp-skin)" />
      <path d="M860 700 C 780 670 700 640 660 622 C 620 606 560 612 530 640 C 514 660 508 684 506 700 Z" fill="url(#fp-skin)" />
      {/* 무릎 */}
      <ellipse cx="398" cy="636" rx="70" ry="38" fill="url(#fp-knee)" />
      <ellipse cx="602" cy="636" rx="70" ry="38" fill="url(#fp-knee)" />
      <path d="M352 650 q46 16 92 0 M556 650 q46 16 92 0" stroke="#a96c4a" strokeWidth="1.6" fill="none" opacity="0.45" />
      {/* 허벅지 안쪽 그늘 */}
      <path d="M440 700 Q 470 660 486 700 Z M560 700 Q 530 660 514 700 Z" fill="#7a4a31" opacity="0.35" />
    </g>
  );
}

export interface CigaretteShape {
  lit: boolean;
  /** 아직 타지 않은 종이 부분 길이 */
  paper: number;
  /** 끝에 매달린 재 길이 */
  ash: number;
}

/** 담배 한 개비: 필터(코르크 무늬) → 종이 → 그을린 띠 → 불씨 → 매달린 재. 담배 축은 -x 방향 */
export function CigaretteBody({ shape, inhaling }: { shape: CigaretteShape; inhaling: boolean }) {
  const tip = -FILTER - shape.paper;
  // 재가 길어지면 무게 때문에 아래로 처진다
  const droop = Math.max(0, shape.ash - 18) * 0.5;
  return (
    <g>
      <rect x={-FILTER} y="-6" width={FILTER} height="12" rx="1.5" fill="url(#fp-cork)" />
      <rect x={-FILTER} y="-6" width="2" height="12" fill="#c9a227" />
      <rect x={tip} y="-6" width={shape.paper} height="12" fill="#f6f3ec" />
      <rect x={-FILTER - 10} y="-6" width="1" height="12" fill="#d6d0c2" />
      <rect x={tip} y="-6" width={shape.paper + FILTER} height="12" fill="url(#fp-cyl)" />
      {shape.lit && (
        <>
          {/* 타 들어가며 그을린 종이 끝 */}
          <path d={`M${tip + 6} -6 l-3 2 l2 3 l-3 2 l2 3 l2 2 L${tip} 6 L${tip} -6 Z`} fill="#3b2a1d" opacity="0.85" />
          {shape.ash > 0 && (
            <g transform={`translate(${tip} 0) rotate(${-droop})`}>
              <path
                d={`M0 -5.5 L${-shape.ash + 3} -5 Q${-shape.ash - 1} 0 ${-shape.ash + 3} 5.2 L0 5.5 Z`}
                fill="url(#fp-ash)"
              />
              {/* 재에 생긴 잔금 */}
              <path
                d={`M${-shape.ash * 0.3} -5 l1 4 M${-shape.ash * 0.6} -5 l-1 6 l2 4 M${-shape.ash * 0.8} 1 l2 3`}
                stroke="#5c636a"
                strokeWidth="0.7"
                fill="none"
              />
            </g>
          )}
          <circle cx={tip} cy="0" r={inhaling ? 13 : 9} fill="url(#fp-ember-glow)" />
          <rect className={inhaling ? 'fp-ember fp-ember--hot' : 'fp-ember'} x={tip - 2.5} y="-6" width="5" height="12" rx="2" />
        </>
      )}
    </g>
  );
}

/**
 * 오른손: 검지와 중지 사이에 담배를 끼운 손등 쪽 모습. 담배 축 좌표계(-x 방향이 담배 끝)로 그린다.
 * cigarette이 없으면 휴지 뭉치를 쥔 손이 된다.
 */
export function HandArt({ shape, inhaling, holdingPaper = false }: { shape: CigaretteShape | null; inhaling: boolean; holdingPaper?: boolean }) {
  return (
    <g>
      {/* 소매와 팔목 */}
      <path d="M70 -6 C 120 -14 230 30 260 90 L 200 170 C 150 110 90 70 60 52 Z" fill="url(#fp-sleeve)" />
      <path d="M66 -4 C 80 10 84 40 62 52" stroke="#55595f" strokeWidth="3" fill="none" />
      {/* 엄지 (손 아래쪽에 말려 있다) */}
      <path d="M58 30 C 40 40 14 40 2 32 C -4 28 0 20 8 20 C 24 22 40 18 52 14 Z" fill="url(#fp-skin)" />
      <path d="M4 22 c-3 2 -3 7 1 8" stroke="#f7dcc6" strokeWidth="2" fill="none" />
      {/* 접힌 약지·새끼손가락 마디 */}
      <ellipse cx="22" cy="22" rx="12" ry="9" fill="#d29672" />
      <ellipse cx="34" cy="30" rx="11" ry="8" fill="#c88a66" />
      {/* 손등 */}
      <path d="M14 -24 C 40 -30 70 -22 76 -2 C 80 18 70 40 46 44 C 30 46 16 34 10 20 C 6 6 6 -14 14 -24 Z" fill="url(#fp-skin-side)" />
      <path d="M40 -18 c10 10 12 30 4 46 M58 -12 c6 10 6 26 0 40" stroke="#b47652" strokeWidth="1.4" fill="none" opacity="0.35" />

      {shape ? (
        <CigaretteBody shape={shape} inhaling={inhaling} />
      ) : holdingPaper ? (
        <g transform="translate(-22 2)">
          <path d="M-20 -6 c-6 -12 8 -22 18 -16 c8 -10 26 -4 24 8 c12 4 8 22 -4 22 c-4 10 -24 10 -26 0 c-12 0 -16 -8 -12 -14 Z" fill="url(#fp-paper)" />
          <path d="M-12 -8 c6 2 8 6 6 12 M2 -12 c2 6 0 10 -4 12 M8 4 c4 0 8 2 8 6" stroke="#b5ae9c" strokeWidth="1" fill="none" />
        </g>
      ) : null}

      {/* 손가락이 담배에 드리운 그림자 */}
      {shape && <rect x="-62" y="-6" width="62" height="12" fill="#000" opacity="0.12" />}
      {/* 중지 (담배 아래쪽): 손끝이 필터를 지나 종이 부분까지 온다 */}
      <path d="M18 5 C -8 5 -40 7 -60 10 C -68 12 -68 22 -60 24 C -38 26 -6 26 18 24 Z" fill="url(#fp-skin)" />
      <path d="M-64 12 C -68 14 -68 21 -64 23 L -54 23 C -56 20 -56 15 -54 12 Z" fill="#f4d4c3" />
      <path d="M-64 13 c2 1 5 1 8 0" stroke="#fff" strokeWidth="1" opacity="0.45" />
      <path d="M-16 7 c-2 5 -2 12 0 17 M-42 9 c-2 4 -2 10 0 14" stroke="#a96c4a" strokeWidth="1.2" fill="none" opacity="0.55" />
      {/* 검지 (담배 위쪽) */}
      <path d="M18 -27 C -6 -26 -36 -22 -56 -18 C -64 -16 -66 -8 -58 -6 C -36 -5 -8 -5 18 -5 Z" fill="url(#fp-skin)" />
      <path d="M-62 -16 C -66 -13 -66 -9 -62 -7 L -52 -7 C -54 -10 -54 -14 -52 -17 Z" fill="#f4d4c3" />
      <path d="M-61 -15 c2 1 5 1 8 0" stroke="#fff" strokeWidth="1" opacity="0.45" />
      <path d="M-14 -24 c-2 5 -2 12 0 17 M-38 -21 c-2 4 -2 10 0 14" stroke="#a96c4a" strokeWidth="1.2" fill="none" opacity="0.55" />
      <path d="M10 -24 C -20 -22 -40 -19 -54 -16" stroke="#f9dcc4" strokeWidth="2" fill="none" opacity="0.5" />
      {/* 손가락 뿌리 마디 */}
      <path d="M14 -22 c4 4 4 10 0 14 M16 8 c4 4 4 10 0 14" stroke="#a96c4a" strokeWidth="1.4" fill="none" opacity="0.5" />
      <ellipse cx="18" cy="-16" rx="5" ry="3" fill="#f6d3b5" opacity="0.6" />
      <ellipse cx="20" cy="14" rx="5" ry="3" fill="#f6d3b5" opacity="0.6" />
    </g>
  );
}

/** 실에 매달려 흔들리는 작은 거미 */
export function Spider() {
  return (
    <g transform="translate(742 70)" aria-hidden="true">
      <g className="fp-spider-swing">
        <line x1="0" y1="0" x2="0" y2="74" stroke="#dfe5e1" strokeWidth="0.7" opacity="0.5" />
        <g transform="translate(0 80)">
          <path
            d="M-3 -2 l-9 -6 l-4 4 M-3 0 l-10 -1 l-4 5 M-3 2 l-9 5 l-2 6 M3 -2 l9 -6 l4 4 M3 0 l10 -1 l4 5 M3 2 l9 5 l2 6"
            stroke="#0b0d0c"
            strokeWidth="1.2"
            fill="none"
          />
          <ellipse cx="0" cy="-3" rx="3.2" ry="3" fill="#121514" />
          <ellipse cx="0" cy="3" rx="4.4" ry="5.4" fill="#121514" />
        </g>
      </g>
    </g>
  );
}

/** 천장 형광등: 가끔 깜빡이며 화면 전체가 순간 어두워진다 */
export function Fluorescent() {
  return (
    <g aria-hidden="true">
      <rect x="420" y="20" width="160" height="14" rx="7" fill="#fffbe6" />
      <rect x="414" y="16" width="172" height="6" rx="2" fill="#5c6560" />
      <ellipse cx="500" cy="34" rx="200" ry="34" fill="#fff6c9" opacity="0.08" />
      <rect className="fp-flicker" width="1000" height="700" fill="#000" pointerEvents="none" />
    </g>
  );
}
