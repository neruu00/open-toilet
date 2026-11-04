import type { SoundAction, SoundVariant } from '@open-toilet/protocol';

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

  play(action: SoundAction, variant?: SoundVariant): void {
    const ctx = this.ctx;
    if (this.muted || !ctx || ctx.state !== 'running') return;
    while (this.playing.length >= MAX_CONCURRENT) this.playing.shift()?.stop();
    const handle = this.synth(ctx, action, variant);
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

  /** 퐁·철퍽: 음높이가 빠르게 떨어지는 짧은 사인파 */
  private blip(ctx: AudioContext, out: AudioNode, sources: AudioScheduledSourceNode[], at: number, freq: number, level: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.3, at + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + 0.25);
    sources.push(osc);
  }

  /** 비비적: 저역 노이즈를 짧게 긁는다 */
  private scrape(ctx: AudioContext, out: AudioNode, sources: AudioScheduledSourceNode[], at: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 700;
    band.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.5, at + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    src.connect(band).connect(g).connect(out);
    src.start(at);
    src.stop(at + 0.2);
    sources.push(src);
  }

  /** 콜록: 거친 숨이 터지고 가슴이 울리는 낮은 소리 */
  private cough(ctx: AudioContext, out: AudioNode, sources: AudioScheduledSourceNode[], at: number): void {
    const burst = ctx.createBufferSource();
    burst.buffer = this.noise(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(700, at);
    band.frequency.exponentialRampToValueAtTime(380, at + 0.16);
    band.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.8, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    burst.connect(band).connect(g).connect(out);
    burst.start(at);
    burst.stop(at + 0.22);
    sources.push(burst);
    this.blip(ctx, out, sources, at, 150, 0.4);
  }

  private synth(ctx: AudioContext, action: SoundAction, variant?: SoundVariant): Playing {
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
    } else if (action === 'poop') {
      duration = 1.2;
      master.gain.value = 1;
      // 뿌지직: 낮은 노이즈가 떨리듯 이어진다
      const noise = ctx.createBufferSource();
      noise.buffer = this.noise(ctx);
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.setValueAtTime(380, t0);
      low.frequency.exponentialRampToValueAtTime(140, t0 + 0.55);
      const wobble = ctx.createGain();
      wobble.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 17;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(wobble.gain);
      const burst = ctx.createGain();
      burst.gain.setValueAtTime(0.0001, t0);
      burst.gain.exponentialRampToValueAtTime(1, t0 + 0.04);
      burst.gain.setValueAtTime(1, t0 + 0.45);
      burst.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      noise.connect(low).connect(wobble).connect(burst).connect(master);
      for (const node of [noise, lfo]) {
        node.start(t0);
        node.stop(t0 + 0.65);
        sources.push(node);
      }
      // 퐁당: 물에 떨어지는 소리 두 번
      [0.62, 0.86].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(i === 0 ? 260 : 200, t0 + offset);
        osc.frequency.exponentialRampToValueAtTime(70, t0 + offset + 0.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + offset);
        g.gain.exponentialRampToValueAtTime(i === 0 ? 0.9 : 0.6, t0 + offset + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.26);
        osc.connect(g).connect(master);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.3);
        sources.push(osc);
      });
    } else if (action === 'bidet') {
      duration = 2.2;
      // 삑: 버튼 누르는 전자음
      const beep = ctx.createOscillator();
      beep.type = 'square';
      beep.frequency.value = 1760;
      const beepGain = ctx.createGain();
      beepGain.gain.setValueAtTime(0.0001, t0);
      beepGain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.01);
      beepGain.gain.setValueAtTime(0.15, t0 + 0.09);
      beepGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      beep.connect(beepGain).connect(master);
      beep.start(t0);
      beep.stop(t0 + 0.15);
      sources.push(beep);
      // 쏴아: 고음 노이즈 물줄기가 점점 세졌다가 잦아든다
      const spray = ctx.createBufferSource();
      spray.buffer = this.noise(ctx);
      spray.loop = true;
      const high = ctx.createBiquadFilter();
      high.type = 'bandpass';
      high.Q.value = 1.2;
      high.frequency.setValueAtTime(2200, t0 + 0.2);
      high.frequency.linearRampToValueAtTime(3600, t0 + 0.9);
      high.frequency.linearRampToValueAtTime(2600, t0 + duration);
      const sprayGain = ctx.createGain();
      sprayGain.gain.setValueAtTime(0.0001, t0 + 0.2);
      sprayGain.gain.exponentialRampToValueAtTime(0.6, t0 + 0.45);
      sprayGain.gain.setValueAtTime(0.6, t0 + 1.5);
      sprayGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      spray.connect(high).connect(sprayGain).connect(master);
      spray.start(t0 + 0.2);
      spray.stop(t0 + duration + 0.05);
      sources.push(spray);
      master.gain.value = 0.8;
    } else if (action === 'take') {
      duration = 0.9;
      master.gain.value = 0.7;
      // 바스락: 담배갑 뚜껑을 열고 한 개비를 뽑는다
      [0, 0.12, 0.5].forEach((offset, i) => {
        const rustle = ctx.createBufferSource();
        rustle.buffer = this.noise(ctx);
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = i === 2 ? 1800 : 3200;
        band.Q.value = 0.8;
        const g = ctx.createGain();
        const len = i === 2 ? 0.25 : 0.08;
        g.gain.setValueAtTime(0.0001, t0 + offset);
        g.gain.exponentialRampToValueAtTime(0.4, t0 + offset + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + len);
        rustle.connect(band).connect(g).connect(master);
        rustle.start(t0 + offset);
        rustle.stop(t0 + offset + len + 0.02);
        sources.push(rustle);
      });
    } else if (action === 'light') {
      duration = 1.1;
      master.gain.value = 0.9;
      // 칙, 칙: 라이터 부싯돌 두 번
      [0, 0.28].forEach((offset) => {
        const flint = ctx.createBufferSource();
        flint.buffer = this.noise(ctx);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 3000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + offset);
        g.gain.exponentialRampToValueAtTime(0.7, t0 + offset + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.06);
        flint.connect(hp).connect(g).connect(master);
        flint.start(t0 + offset);
        flint.stop(t0 + offset + 0.08);
        sources.push(flint);
      });
      // 화르륵: 불꽃이 붙는 낮은 바람 소리
      const flame = ctx.createBufferSource();
      flame.buffer = this.noise(ctx);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const fg = ctx.createGain();
      fg.gain.setValueAtTime(0.0001, t0 + 0.3);
      fg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.4);
      fg.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      flame.connect(lp).connect(fg).connect(master);
      flame.start(t0 + 0.3);
      flame.stop(t0 + duration + 0.05);
      sources.push(flame);
    } else if (action === 'puff') {
      duration = 1.2;
      master.gain.value = 0.8;
      // 스읍: 숨을 들이마시는 소리가 점점 높아진다
      const breath = ctx.createBufferSource();
      breath.buffer = this.noise(ctx);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.5;
      band.frequency.setValueAtTime(600, t0);
      band.frequency.linearRampToValueAtTime(1500, t0 + duration);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t0);
      bg.gain.exponentialRampToValueAtTime(0.35, t0 + 0.4);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      breath.connect(band).connect(bg).connect(master);
      breath.start(t0);
      breath.stop(t0 + duration + 0.05);
      sources.push(breath);
      // 타닥타닥: 담뱃잎 타는 소리
      for (let i = 0; i < 9; i++) {
        const at = t0 + 0.1 + Math.random() * 0.9;
        const crackle = ctx.createBufferSource();
        crackle.buffer = this.noise(ctx);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 4000;
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(0.0001, at);
        cg.gain.exponentialRampToValueAtTime(0.4, at + 0.002);
        cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);
        crackle.connect(hp).connect(cg).connect(master);
        crackle.start(at);
        crackle.stop(at + 0.03);
        sources.push(crackle);
      }
    } else if (action === 'exhale') {
      duration = 1.8;
      master.gain.value = 0.8;
      // 후~: 길게 내쉬는 숨소리가 점점 낮아진다
      const breath = ctx.createBufferSource();
      breath.buffer = this.noise(ctx);
      breath.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.9;
      band.frequency.setValueAtTime(1100, t0);
      band.frequency.linearRampToValueAtTime(450, t0 + duration);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t0);
      bg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.2);
      bg.gain.setValueAtTime(0.5, t0 + 0.9);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      breath.connect(band).connect(bg).connect(master);
      breath.start(t0);
      breath.stop(t0 + duration + 0.05);
      sources.push(breath);
    } else if (action === 'snuff_wall' || action === 'snuff_toilet' || action === 'snuff_floor') {
      duration = 1.2;
      master.gain.value = 0.8;
      const start = action === 'snuff_wall' ? 0.25 : action === 'snuff_toilet' ? 0.45 : 0.35;
      if (action === 'snuff_toilet') {
        // 퐁: 꽁초가 물에 떨어진다
        this.blip(ctx, master, sources, t0 + 0.4, 520, 0.5);
      }
      if (action === 'snuff_floor') {
        // 비비적: 신발 밑창이 바닥을 긁는다
        [0.35, 0.6, 0.85].forEach((offset) => this.scrape(ctx, master, sources, t0 + offset));
      } else {
        // 치이익: 불이 꺼지는 소리
        const hiss = ctx.createBufferSource();
        hiss.buffer = this.noise(ctx);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 5000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + start);
        g.gain.exponentialRampToValueAtTime(0.45, t0 + start + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
        hiss.connect(hp).connect(g).connect(master);
        hiss.start(t0 + start);
        hiss.stop(t0 + duration + 0.05);
        sources.push(hiss);
      }
    } else if (action === 'spit' || action === 'phlegm') {
      const phlegm = action === 'phlegm';
      duration = phlegm ? 1.9 : 0.6;
      master.gain.value = 0.9;
      const spitAt = phlegm ? t0 + 1.1 : t0;
      if (phlegm) {
        // 카아악: 목을 긁어 올리는 거친 소리
        const rasp = ctx.createOscillator();
        rasp.type = 'sawtooth';
        rasp.frequency.setValueAtTime(70, t0);
        rasp.frequency.linearRampToValueAtTime(110, t0 + 0.9);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 38;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.5;
        const amp = ctx.createGain();
        amp.gain.value = 0.5;
        lfo.connect(lfoGain).connect(amp.gain);
        const noise = ctx.createBufferSource();
        noise.buffer = this.noise(ctx);
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 1200;
        band.Q.value = 0.7;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.25);
        g.gain.setValueAtTime(0.6, t0 + 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
        rasp.connect(amp).connect(g);
        noise.connect(band).connect(g);
        g.connect(master);
        for (const node of [rasp, lfo, noise]) {
          node.start(t0);
          node.stop(t0 + 1.05);
          sources.push(node);
        }
      }
      // 퉤: 짧고 날카로운 바람 소리
      const ptui = ctx.createBufferSource();
      ptui.buffer = this.noise(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2;
      bp.frequency.setValueAtTime(2500, spitAt);
      bp.frequency.exponentialRampToValueAtTime(900, spitAt + 0.12);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(0.0001, spitAt);
      pg.gain.exponentialRampToValueAtTime(0.8, spitAt + 0.01);
      pg.gain.exponentialRampToValueAtTime(0.0001, spitAt + 0.15);
      ptui.connect(bp).connect(pg).connect(master);
      ptui.start(spitAt);
      ptui.stop(spitAt + 0.2);
      sources.push(ptui);
      // 철퍽: 바닥에 떨어진다
      this.blip(ctx, master, sources, spitAt + (phlegm ? 0.45 : 0.3), phlegm ? 160 : 300, phlegm ? 0.7 : 0.35);
    } else if (action === 'wipe') {
      duration = 2.3;
      master.gain.value = 0.7;
      // 드르르륵: 롤이 헛돌며 휴지가 풀린다
      for (let i = 0; i < 7; i++) this.scrape(ctx, master, sources, t0 + 0.08 + i * 0.05);
      // 부욱: 절취선을 따라 뜯는다
      const tear = ctx.createBufferSource();
      tear.buffer = this.noise(ctx);
      const tearBand = ctx.createBiquadFilter();
      tearBand.type = 'bandpass';
      tearBand.Q.value = 1.4;
      tearBand.frequency.setValueAtTime(1200, t0 + 0.45);
      tearBand.frequency.exponentialRampToValueAtTime(3800, t0 + 0.6);
      const tearGain = ctx.createGain();
      tearGain.gain.setValueAtTime(0.0001, t0 + 0.45);
      tearGain.gain.exponentialRampToValueAtTime(0.7, t0 + 0.47);
      tearGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.62);
      tear.connect(tearBand).connect(tearGain).connect(master);
      tear.start(t0 + 0.45);
      tear.stop(t0 + 0.65);
      sources.push(tear);
      // 쓱싹 쓱싹: 종이가 스치는 소리 두 번
      [1.0, 1.35, 1.65, 2.0].forEach((at) => {
        const swish = ctx.createBufferSource();
        swish.buffer = this.noise(ctx);
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = 0.9;
        band.frequency.setValueAtTime(2600, t0 + at);
        band.frequency.exponentialRampToValueAtTime(1100, t0 + at + 0.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.22);
        swish.connect(band).connect(g).connect(master);
        swish.start(t0 + at);
        swish.stop(t0 + at + 0.25);
        sources.push(swish);
      });
    } else if (action === 'ash') {
      duration = 0.5;
      master.gain.value = 0.6;
      // 톡톡: 손가락으로 담배를 두드리는 소리
      [0, 0.16].forEach((offset) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(420, t0 + offset);
        osc.frequency.exponentialRampToValueAtTime(160, t0 + offset + 0.05);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + offset);
        g.gain.exponentialRampToValueAtTime(0.6, t0 + offset + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.07);
        osc.connect(g).connect(master);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.09);
        sources.push(osc);
      });
    } else if (action === 'burnout') {
      duration = 1.1;
      master.gain.value = 0.9;
      // 치익: 다 탄 필터가 손가락에 닿아 지글거린다
      const hiss = ctx.createBufferSource();
      hiss.buffer = this.noise(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 4500;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.0001, t0);
      hg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
      hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      hiss.connect(hp).connect(hg).connect(master);
      hiss.start(t0);
      hiss.stop(t0 + 0.45);
      sources.push(hiss);
      // 아뜨뜨: 짧게 올라갔다 떨어지는 소리 세 번
      [0.12, 0.34, 0.5].forEach((at, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(i === 0 ? 900 : 780, t0 + at);
        osc.frequency.exponentialRampToValueAtTime(480, t0 + at + 0.14);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.16);
        osc.connect(g).connect(master);
        osc.start(t0 + at);
        osc.stop(t0 + at + 0.18);
        sources.push(osc);
      });
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

    if (variant === 'cough') {
      // 콜록콜록: 들이마신 뒤 사레들려 연달아 기침한다
      duration = Math.max(duration, 2.2);
      [1.05, 1.4, 1.72].forEach((at) => this.cough(ctx, master, sources, t0 + at));
    } else if (variant === 'ring') {
      // 포, 포: 입을 오므려 도넛 연기를 밀어낸다
      duration = Math.max(duration, 1.4);
      [0.2, 0.62].forEach((at) => this.blip(ctx, master, sources, t0 + at, 220, 0.3));
    }

    for (const source of sources) {
      // 방귀·물 내리기 말고는 소리별로 시작/정지 시각을 이미 예약해 두었다
      if (action !== 'fart' && action !== 'flush') continue;
      source.start(t0);
      source.stop(t0 + duration + 0.05);
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
