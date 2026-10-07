import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { ActionType, Participant, Snapshot } from '@open-toilet/protocol';
import { client, type ClientState } from './connection/client';
import { NameScreen } from './components/NameScreen';
import { Scene } from './components/Scene';

function useClientState(): ClientState {
  return useSyncExternalStore(client.subscribe, client.getState);
}

/** 서버 시각 보정이 적용된 현재 시각 (200ms마다 갱신) */
function useServerNow(offset: number): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset), 200);
    return () => window.clearInterval(id);
  }, [offset]);
  return now;
}

export function App() {
  const state = useClientState();

  useEffect(() => {
    client.start();
  }, []);

  if (state.phase === 'booting') return null;
  if (state.phase === 'name' || (state.phase === 'connecting' && !state.snapshot && !state.userId)) {
    return <NameScreen error={state.nameError} notice={state.notice} busy={state.phase === 'connecting'} />;
  }
  if (!state.snapshot || !state.userId) {
    return (
      <main className="center-message" role="status">
        {state.phase === 'replaced' ? <Replaced notice={state.notice} /> : '연결하는 중…'}
      </main>
    );
  }
  return <Main state={state} snapshot={state.snapshot} selfId={state.userId} />;
}

function Replaced({ notice }: { notice: string | null }) {
  return (
    <div className="name-card">
      <h1>다른 탭에서 연결됨</h1>
      <p className="lead">{notice ?? '다른 탭에서 같은 계정으로 접속했습니다.'}</p>
      <button className="btn btn--primary" onClick={() => client.reconnectTab()}>
        이 탭에서 다시 연결
      </button>
    </div>
  );
}

function Main({ state, snapshot, selfId }: { state: ClientState; snapshot: Snapshot; selfId: string }) {
  const serverNow = useServerNow(state.clockOffset);
  const connected = state.phase === 'ready';
  const replaced = state.phase === 'replaced';

  const byId = new Map(snapshot.participants.map((p) => [p.userId, p]));
  const inBooth = snapshot.booth.occupantId === selfId;
  const occupied = snapshot.booth.occupantId !== null;
  const queueIndex = snapshot.queue.indexOf(selfId);
  const inQueue = queueIndex >= 0;
  const isHead = queueIndex === 0;
  const reservedForOther = snapshot.priority !== null && snapshot.priority.userId !== selfId;
  const cooldown = (action: ActionType) => Math.max(0, snapshot.self.cooldownUntil[action] - serverNow);
  const withCooldown = (action: ActionType, label: string) => {
    const left = cooldown(action);
    return left > 0 ? `${label} (${Math.ceil(left / 1000)})` : label;
  };

  // 지금 쓸 수 있는 버튼만 보여준다 (연결이 끊기면 전부 숨김)
  const showEnter = connected && !occupied && !reservedForOther;
  const showLeave = connected && inBooth;
  const showFart = connected && inBooth;
  const showPoop = connected && inBooth;
  const showFlush = connected && inBooth;
  const showJoin = connected && occupied && !inBooth && !inQueue;
  const showCancel = connected && inQueue;
  const showKnock = connected && occupied && !inBooth && isHead;

  return (
    <main className="main">
      <Scene snapshot={snapshot} selfId={selfId} serverNow={serverNow} bubbles={state.bubbles} effects={state.effects} />

      <header className="hud hud--top-left">
        <h1>
          <span aria-hidden="true">🚽</span> Open Toilet
        </h1>
        <span className={`conn conn--${connected ? 'on' : 'off'}`} role="status">
          {replaced ? '다른 탭에서 연결됨' : connected ? '연결됨' : '재연결 중…'}
        </span>
      </header>


      <div className="hud hud--bottom-left">
        <div className="toast-area" aria-live="polite">
          {state.notice && <div className="toast toast--error">{state.notice}</div>}
          {state.activities.map((a) => (
            <div key={a.id} className="toast">
              {a.text}
            </div>
          ))}
        </div>
      </div>

      <details className="hud hud--lists" open={window.innerWidth > 720}>
        <summary>
          접속자 {snapshot.participants.length} · 대기 {snapshot.queue.length}
        </summary>
        <ParticipantList snapshot={snapshot} selfId={selfId} />
        <QueueList snapshot={snapshot} selfId={selfId} byId={byId} serverNow={serverNow} />
      </details>

      {(!state.tokenPersisted || replaced || !connected) && (
        <div className="banner" role="status">
          {replaced ? (
            <>
              다른 탭에서 연결했어요.{' '}
              <button className="link" onClick={() => client.reconnectTab()}>
                이 탭에서 다시 연결
              </button>
            </>
          ) : !connected ? (
            '연결이 끊겼어요. 자리는 잠시 유지되며 자동으로 다시 연결합니다.'
          ) : (
            '브라우저 저장소를 쓸 수 없어 새로고침하면 다시 이름을 입력해야 해요.'
          )}
        </div>
      )}

      <ChatForm enabled={connected} maxLength={state.config?.chatMaxLength ?? 60} />

      {/* column-reverse: DOM 맨 앞이 화면 맨 아래 */}
      <nav className="fab-stack" aria-label="내 동작">
        {(showEnter || showLeave) && (
          <div className="fab-row">
            {showPoop && (
              <IconFab icon="💩" label="똥" leftMs={cooldown('poop')} onClick={() => void client.perform('poop')} />
            )}
            {showFart && (
              <IconFab icon="💨" label="방귀" leftMs={cooldown('fart')} onClick={() => void client.perform('fart')} />
            )}
            {showFlush && (
              <IconFab icon="🚽" label="물 내리기" leftMs={cooldown('flush')} onClick={() => void client.perform('flush')} />
            )}
            {showEnter && (
              <button className="fab fab--primary" onClick={() => void client.enterBooth()}>
                🚪 들어가기
              </button>
            )}
            {showLeave && (
              <button className="fab fab--primary" onClick={() => void client.leaveBooth()}>
                🚶 나가기
              </button>
            )}
          </div>
        )}
        {showKnock && (
          <button className="fab" disabled={cooldown('knock') > 0} onClick={() => void client.perform('knock')}>
            ✊ {withCooldown('knock', '문 두드리기')}
          </button>
        )}
        {showJoin && (
          <button className="fab fab--primary" onClick={() => void client.joinQueue()}>
            🧍 줄 서기
          </button>
        )}
        {showCancel && (
          <button className="fab" onClick={() => void client.cancelQueue()}>
            ✖ 대기 취소
          </button>
        )}
      </nav>
    </main>
  );
}

/** 채팅 입력: Enter로 보내면 내 머리 위에 말풍선이 뜬다. */
function ChatForm({ enabled, maxLength }: { enabled: boolean; maxLength: number }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending || !enabled) return;
    setSending(true);
    const ok = await client.chat(trimmed);
    setSending(false);
    if (ok) setText(''); // 쿨다운 등으로 거절되면 입력한 내용을 남겨 둔다
  };

  return (
    <form className="chat-form" onSubmit={(e) => void submit(e)}>
      <label className="sr-only" htmlFor="chat-input">
        채팅 메시지
      </label>
      <input
        id="chat-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={maxLength}
        disabled={!enabled}
        autoComplete="off"
        placeholder="채팅 입력 후 Enter"
        enterKeyHint="send"
      />
      <button type="submit" className="chat-send" disabled={!enabled || sending || text.trim() === ''} aria-label="보내기">
        ➤
      </button>
    </form>
  );
}

/** 아이콘만 있는 원형 버튼. 호버/포커스 시 툴팁, 쿨다운 중에는 남은 초를 보여준다. */
function IconFab({ icon, label, leftMs, onClick }: { icon: string; label: string; leftMs: number; onClick: () => void }) {
  const cooling = leftMs > 0;
  const seconds = Math.ceil(leftMs / 1000);
  return (
    <button
      className="fab fab--icon"
      disabled={cooling}
      onClick={onClick}
      aria-label={cooling ? `${label} (${seconds}초 후 가능)` : label}
      data-tip={cooling ? `${label} · ${seconds}초` : label}
    >
      <span aria-hidden="true">{icon}</span>
      {cooling && (
        <span className="fab-count" aria-hidden="true">
          {seconds}
        </span>
      )}
    </button>
  );
}

function statusLabel(p: Participant): string {
  return p.status === 'disconnected' ? '연결 끊김' : '접속 중';
}

function ParticipantList({ snapshot, selfId }: { snapshot: Snapshot; selfId: string }) {
  return (
    <section aria-label="접속자">
      <h2>접속자</h2>
      <ul className="list">
        {snapshot.participants.map((p) => {
          const where =
            p.userId === snapshot.booth.occupantId
              ? '부스 안'
              : snapshot.queue.includes(p.userId)
                ? `대기 ${snapshot.queue.indexOf(p.userId) + 1}번`
                : '';
          return (
            <li key={p.userId} className={p.status === 'disconnected' ? 'is-off' : ''}>
              <span className={`dot dot--${p.status}`} aria-hidden="true" />
              <span className="li-name">
                {p.name}
                {p.userId === selfId && <em className="me">나</em>}
              </span>
              {where && <span className="chip">{where}</span>}
              <span className="li-status">{statusLabel(p)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function QueueList({
  snapshot,
  selfId,
  byId,
  serverNow,
}: {
  snapshot: Snapshot;
  selfId: string;
  byId: Map<string, Participant>;
  serverNow: number;
}) {
  return (
    <section aria-label="대기열">
      <h2>대기열</h2>
      {snapshot.queue.length === 0 ? (
        <p className="empty">줄 선 사람이 없어요.</p>
      ) : (
        <ol className="list">
          {snapshot.queue.map((userId, index) => {
            const p = byId.get(userId);
            const priority = snapshot.priority?.userId === userId ? snapshot.priority : null;
            return (
              <li key={userId} className={p?.status === 'disconnected' ? 'is-off' : ''}>
                <span className="rank">{index + 1}</span>
                <span className="li-name">
                  {p?.name ?? '?'}
                  {userId === selfId && <em className="me">나</em>}
                </span>
                {priority && (
                  <span className="chip chip--hot">
                    우선 입장 {Math.max(0, Math.ceil((priority.expiresAt - serverNow) / 1000))}초
                  </span>
                )}
                <span className="li-status">{p ? statusLabel(p) : ''}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
