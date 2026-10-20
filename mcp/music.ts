import fs from "node:fs";
import type { StyleDef } from "../shared/styles";

/**
 * Procedural, royalty-free soundtrack matched to a style: tempo, key, drums and brightness.
 * Shots are cut on this track's beat grid, so the edit lands on the music.
 */

const SR = 44100;

// Scale degrees (semitones from the key root) for four-chord loops.
const PROGRESSIONS = {
  major: [
    [0, 4, 7], // I
    [7, 11, 14], // V
    [9, 12, 16], // vi
    [5, 9, 12], // IV
  ],
  minor: [
    [0, 3, 7], // i
    [8, 12, 15], // VI
    [3, 7, 10], // III
    [10, 14, 17], // VII
  ],
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export function synthesizeTrack(music: StyleDef["music"], seconds: number, seed = 7): Float32Array[] {
  const n = Math.ceil(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rand = rng(seed);
  const beat = 60 / music.bpm;
  const barLen = beat * 4;
  const chordBars = music.bpm < 85 ? 2 : 1;
  const roots = music.mode === "minor" ? [57, 52, 50, 55] : [48, 53, 55, 50]; // A/E/D/G minor or C/F/G/D major
  const root = roots[Math.floor(rand() * roots.length)];
  const prog = PROGRESSIONS[music.mode];
  const bars = Math.ceil(seconds / barLen);
  const b = music.brightness;

  const add = (buf: Float32Array, i: number, v: number) => {
    if (i >= 0 && i < n) buf[i] += v;
  };

  for (let bar = 0; bar < bars; bar++) {
    const chord = prog[Math.floor(bar / chordBars) % prog.length];
    const barStart = bar * barLen;
    const isIntro = bar < 2;
    const isOutro = bar >= bars - 2;

    // Pad: detuned additive voices with slow attack; brightness adds upper harmonics.
    if (bar % chordBars === 0) {
      const len = barLen * chordBars;
      const s0 = Math.floor(barStart * SR);
      const notes = [...chord.map((d) => root + d), root + chord[0] + 12];
      for (let k = 0; k < len * SR; k++) {
        const t = k / SR;
        const env = Math.min(1, t / 0.6) * Math.min(1, (len - t) / 0.5);
        let l = 0;
        let r = 0;
        for (const m of notes) {
          const f = hz(m);
          for (let h = 1; h <= 1 + Math.round(b * 3); h++) {
            const amp = 1 / (h * h);
            l += amp * Math.sin(2 * Math.PI * f * h * 1.002 * t);
            r += amp * Math.sin(2 * Math.PI * f * h * 0.998 * t + 0.4);
          }
        }
        add(L, s0 + k, l * env * 0.035);
        add(R, s0 + k, r * env * 0.035);
      }
    }

    // Bass on the root, on every beat (or half notes for slow styles).
    const bassStep = music.drums === "four" ? beat : beat * 2;
    for (let t0 = 0; t0 < barLen - 1e-6; t0 += bassStep) {
      if (isIntro && music.drums !== "none") continue;
      const f = hz(root + chord[0] - 12);
      const s0 = Math.floor((barStart + t0) * SR);
      const len = bassStep * 0.9;
      for (let k = 0; k < len * SR; k++) {
        const t = k / SR;
        const env = Math.min(1, t / 0.01) * Math.exp(-t * (music.drums === "four" ? 5 : 2));
        const v = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sign(Math.sin(2 * Math.PI * f * t))) * env * 0.16;
        add(L, s0 + k, v);
        add(R, s0 + k, v);
      }
    }

    // Arpeggio for bright styles: chord tones on 8th notes, plucked.
    if (b >= 0.6 && !isIntro) {
      const step = beat / 2;
      for (let j = 0; j < 8; j++) {
        const m = root + 12 + chord[j % 3] + (j >= 4 ? 12 : 0);
        const s0 = Math.floor((barStart + j * step) * SR);
        for (let k = 0; k < step * SR; k++) {
          const t = k / SR;
          const tri = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * hz(m) * t));
          const v = tri * Math.exp(-t * 9) * 0.05 * b;
          add(L, s0 + k, v * (j % 2 ? 0.6 : 1));
          add(R, s0 + k, v * (j % 2 ? 1 : 0.6));
        }
      }
    }

    // Drums.
    if (music.drums === "none" || isIntro || isOutro) continue;
    for (let q = 0; q < 4; q++) {
      const t0 = barStart + q * beat;
      const kick = music.drums === "four" || q === 0 || (music.drums === "soft" && q === 2);
      const snare = music.drums === "halftime" ? q === 2 : q === 1 || q === 3;
      if (kick) {
        const s0 = Math.floor(t0 * SR);
        let phase = 0;
        for (let k = 0; k < 0.35 * SR; k++) {
          const t = k / SR;
          phase += (2 * Math.PI * (45 + 110 * Math.exp(-t * 30))) / SR;
          const v = Math.sin(phase) * Math.exp(-t * 9) * (music.drums === "soft" ? 0.35 : 0.5);
          add(L, s0 + k, v);
          add(R, s0 + k, v);
        }
      }
      if (snare) {
        const s0 = Math.floor(t0 * SR);
        let lp = 0;
        for (let k = 0; k < 0.2 * SR; k++) {
          const t = k / SR;
          const noise = rand() * 2 - 1;
          lp += 0.35 * (noise - lp);
          const v = ((noise - lp) * 0.7 + 0.3 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 18) * (music.drums === "soft" ? 0.12 : 0.22);
          add(L, s0 + k, v);
          add(R, s0 + k, v);
        }
      }
      // Hats on 8ths, louder for bright styles.
      if (b >= 0.4) {
        for (const off of [0, beat / 2]) {
          const s0 = Math.floor((t0 + off) * SR);
          let prev = 0;
          for (let k = 0; k < 0.05 * SR; k++) {
            const noise = rand() * 2 - 1;
            const hp = noise - prev;
            prev = noise;
            const v = hp * Math.exp(-(k / SR) * 80) * 0.05 * b * (off ? 1 : 0.6);
            add(L, s0 + k, v * 0.8);
            add(R, s0 + k, v);
          }
        }
      }
    }
  }

  // Gentle master: normalise and soft-clip.
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.9 / peak;
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh(L[i] * g * 1.2) * 0.85;
    R[i] = Math.tanh(R[i] * g * 1.2) * 0.85;
  }
  return [L, R];
}

export function writeWav(file: string, [L, R]: Float32Array[]) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}
