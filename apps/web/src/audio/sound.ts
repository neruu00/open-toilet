import type { ActionType } from '@open-toilet/protocol';

// 음원 파일(라이선스 이슈) 없이 Web Audio로 효과음을 합성한다.
// SPEC 8장의 /sounds/*.mp3 를 쓰고 싶다면 play()에서 파일 로드로 교체하면 된다.

const MAX_CONCURRENT = 4;
const MUTE_KEY = 'open-toilet.muted';

interface Playing {
  stop: () => void;
}

class SoundPlayer {
  private ctx: AudioContext | null = null;
  private playing: Playing[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  muted = readMuted();

  get locked(): boolean {
    return !this.ctx || this.ctx.state !== 'running';
  }

  /** 반드시 사용자 제스처(클릭) 핸들러 안에서 호출한다. */
  async unlock(): Promise<void> {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
    } catch {
      /* 오디오 불가 환경: 상태 처리는 계속한다 */
    }
  }

  setMuted(value: boolean): void {
    this.muted = value;
    try {
      localStorage.setItem(MUTE_KEY, value ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  play(action: ActionType): void {
    const ctx = this.ctx;
    if (this.muted || !ctx || ctx.state !== 'running') return;
    while (this.playing.length >= MAX_CONCURRENT) this.playing.shift()?.stop();
    const handle = this.synth(ctx, action);
    this.playing.push(handle);
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  private synth(ctx: AudioContext, action: ActionType): Playing {
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const sources: AudioScheduledSourceNode[] = [];
    let duration = 1;

    if (action === 'fart') {
      duration = 1.3;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(130, t0);
      osc.frequency.exponentialRampToValueAtTime(48, t0 + duration);
      // 떨림(부르르)
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 26;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      const amp = ctx.createGain();
      amp.gain.value = 0.5;
      lfo.connect(lfoGain).connect(amp.gain);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      osc.connect(amp).connect(filter).connect(master);
      master.gain.setValueAtTime(0.0001, t0);
      master.gain.exponentialRampToValueAtTime(0.9, t0 + 0.05);
      master.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      sources.push(osc, lfo);
    } else if (action === 'flush') {
      duration = 3.2;
      const src = ctx.createBufferSource();
      src.buffer = this.noise(ctx);
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.8;
      band.frequency.setValueAtTime(500, t0);
      band.frequency.linearRampToValueAtTime(1800, t0 + 1.2);
      band.frequency.linearRampToValueAtTime(300, t0 + duration);
      src.connect(band).connect(master);
      master.gain.setValueAtTime(0.0001, t0);
      master.gain.exponentialRampToValueAtTime(0.7, t0 + 0.3);
      master.gain.setValueAtTime(0.7, t0 + 1.8);
      master.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      sources.push(src);
    } else {
      duration = 0.9;
      master.gain.value = 1;
      // 똑똑똑
      [0, 0.22, 0.44].forEach((offset) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(190, t0 + offset);
        osc.frequency.exponentialRampToValueAtTime(70, t0 + offset + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + offset);
        g.gain.exponentialRampToValueAtTime(0.9, t0 + offset + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.16);
        osc.connect(g).connect(master);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.2);
        sources.push(osc);
      });
    }

    for (const source of sources) {
      if (action !== 'knock') source.start(t0);
      if (action !== 'knock') source.stop(t0 + duration + 0.05);
    }

    const handle: Playing = {
      stop: () => {
        for (const source of sources) {
          try {
            source.stop();
          } catch {
            /* already stopped */
          }
        }
        master.disconnect();
      },
    };
    window.setTimeout(() => {
      this.playing = this.playing.filter((p) => p !== handle);
      master.disconnect();
    }, (duration + 0.2) * 1000);
    return handle;
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export const sound = new SoundPlayer();
