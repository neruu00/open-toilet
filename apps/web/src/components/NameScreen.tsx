import { useState, type FormEvent } from 'react';
import { client } from '../connection/client';

interface Props {
  error: string | null;
  notice: string | null;
  busy: boolean;
}

export function NameScreen({ error, notice, busy }: Props) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.normalize('NFC').trim();
    const length = [...trimmed].length;
    if (length < 1 || length > 12) {
      setLocalError('이름은 공백 제외 1~12자로 입력해 주세요.');
      return;
    }
    setLocalError(null);
    client.joinWithName(trimmed); // 클릭(제출) 핸들러 안에서 오디오 unlock
  };

  const shown = localError ?? error;

  return (
    <main className="name-screen">
      <form className="name-card" onSubmit={submit}>
        <div className="logo" aria-hidden="true">
          🚽
        </div>
        <h1>Open Toilet</h1>
        <p className="lead">모두가 함께 쓰는 1인용 화장실. 먼저 이름부터 알려주세요.</p>
        {notice && <p className="notice-inline">{notice}</p>}
        <label htmlFor="name">내 이름</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoComplete="off"
          autoFocus
          placeholder="최대 12자"
          aria-invalid={shown ? true : undefined}
          aria-describedby={shown ? 'name-error' : undefined}
        />
        {shown && (
          <p id="name-error" className="field-error" role="alert">
            {shown}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? '접속 중…' : '입장'}
        </button>
        <p className="hint">입장하면 효과음이 켜집니다 🔊</p>
      </form>
    </main>
  );
}
