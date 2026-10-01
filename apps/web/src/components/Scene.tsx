import type { Participant, Snapshot } from '@open-toilet/protocol';

interface SceneProps {
  snapshot: Snapshot;
  selfId: string;
  /** 서버 시각 기준 현재 시각(ms) */
  serverNow: number;
}

const VIEW_W = 1000;
const CX = VIEW_W / 2;
const GROUND_Y = 470;

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

export function Scene({ snapshot, selfId, serverNow }: SceneProps) {
  const byId = new Map(snapshot.participants.map((p) => [p.userId, p]));
  const occupant = snapshot.booth.occupantId ? byId.get(snapshot.booth.occupantId) : undefined;
  const open = !snapshot.booth.occupantId;

  const queued = new Set(snapshot.queue);
  const idle = snapshot.participants.filter((p) => p.userId !== snapshot.booth.occupantId && !queued.has(p.userId));

  const idleCols = 14;
  const idleRows = Math.max(1, Math.ceil(idle.length / idleCols));
  const viewH = 640 + (idleRows - 1) * 90;
  const queueSpacing = Math.min(56, 330 / Math.max(snapshot.queue.length, 1));

  let tagText: string | null = null;
  let tagClass = 'tag';
  if (occupant) {
    const since = snapshot.booth.occupiedSince;
    const elapsed = since === null ? '' : ` · ${formatElapsed(serverNow - since)}`;
    tagText =
      (occupant.status === 'disconnected' ? `${occupant.name} (연결 끊김)` : occupant.name) + elapsed;
    tagClass += ' tag--busy';
  } else if (snapshot.priority) {
    const target = byId.get(snapshot.priority.userId);
    const left = Math.max(0, Math.ceil((snapshot.priority.expiresAt - serverNow) / 1000));
    tagText = `${participantLabel(target)}님 우선 입장 · ${left}초`;
    tagClass += ' tag--reserved';
  }

  const label = occupant
    ? `부스 사용 중: ${occupant.name}, ${formatElapsed(serverNow - (snapshot.booth.occupiedSince ?? serverNow))} 경과`
    : snapshot.priority
      ? `부스 비어 있음, ${participantLabel(byId.get(snapshot.priority.userId))}님 우선 입장 중`
      : '부스 비어 있음';

  const boothTopY = GROUND_Y - BOOTH_HEIGHT_LOCAL * BOOTH_SCALE;

  return (
    <svg
      className="scene"
      viewBox={`0 60 ${VIEW_W} ${viewH - 60}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${label}. 접속자 ${snapshot.participants.length}명, 대기 ${snapshot.queue.length}명`}
    >
      <g transform={`translate(${CX} ${GROUND_Y}) scale(${BOOTH_SCALE}) translate(${-CX} ${-GROUND_Y})`}>
        <Booth open={open} busy={!open} />
      </g>

      {/* 부스 위 이름표 */}
      {tagText && (
        <foreignObject x={CX - 140} y={boothTopY - 52} width="280" height="44">
          <div className={tagClass}>{tagText}</div>
        </foreignObject>
      )}

      {/* 대기열: 부스 오른쪽에 줄 서기 */}
      {snapshot.queue.map((userId, index) => {
        const p = byId.get(userId);
        const isPriority = snapshot.priority?.userId === userId;
        return (
          <Person
            key={userId}
            x={CX + BOOTH_HALF_WIDTH + 90 + index * queueSpacing}
            y={GROUND_Y + 8}
            name={participantLabel(p)}
            isSelf={userId === selfId}
            dim={p?.status === 'disconnected'}
            badge={isPriority ? '입장 차례!' : `${index + 1}번`}
            sub={p?.status === 'disconnected' ? '연결 끊김' : undefined}
          />
        );
      })}

      {/* 부스 사용자는 문 뒤에 있으므로 따로 그리지 않는다 */}
      {idle.map((p, index) => {
        const row = Math.floor(index / idleCols);
        const col = index % idleCols;
        const count = Math.min(idleCols, idle.length - row * idleCols);
        const spacing = 62;
        const startX = CX - ((count - 1) * spacing) / 2;
        return (
          <Person
            key={p.userId}
            x={startX + col * spacing}
            y={GROUND_Y + 150 + row * 90}
            name={p.name}
            isSelf={p.userId === selfId}
            dim={p.status === 'disconnected'}
            sub={p.status === 'disconnected' ? '연결 끊김' : undefined}
          />
        );
      })}
    </svg>
  );
}
