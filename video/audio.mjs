// Original procedural soundtrack for the demo video (no samples, no licences):
// a warm additive pad, a soft arpeggio, a sub bass and noise swells on scene cuts.
import fs from 'node:fs';

const SR = 44100;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
// Am9 - Fmaj7 - Cmaj7 - G6(add9)
const CHORDS = [
  { root: 45, notes: [57, 60, 64, 67, 71] },
  { root: 41, notes: [53, 57, 60, 64, 69] },
  { root: 48, notes: [55, 59, 64, 67, 71] },
  { root: 43, notes: [55, 59, 62, 64, 69] },
];
const BPM = 76, BEAT = 60 / BPM, CHORD_LEN = BEAT * 8;

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function writeSoundtrack(file, duration, cuts = []) {
  const N = Math.ceil(duration * SR);
  const L = new Float32Array(N), R = new Float32Array(N);

  // --- pad: additive, two detuned voices per note, crossfaded chords
  const harmonics = [1, 0.5, 0.28, 0.16, 0.09, 0.05];
  const nChords = Math.ceil(duration / CHORD_LEN) + 1;
  for (let c = 0; c < nChords; c++) {
    const chord = CHORDS[c % CHORDS.length];
    const t0 = c * CHORD_LEN - 1.2, t1 = (c + 1) * CHORD_LEN + 1.2;
    const s0 = Math.max(0, Math.floor(t0 * SR)), s1 = Math.min(N, Math.floor(t1 * SR));
    chord.notes.forEach((m, ni) => {
      [-5, 5].forEach((cents, vi) => {
        const f = midi(m) * Math.pow(2, cents / 1200);
        const pan = 0.5 + (vi ? 0.22 : -0.22) * (ni % 2 ? 1 : -1);
        for (let h = 0; h < harmonics.length; h++) {
          const w = (2 * Math.PI * f * (h + 1)) / SR, a = harmonics[h] * 0.018;
          let ph = (ni * 1.7 + vi * 0.9 + h) % (2 * Math.PI);
          for (let s = s0; s < s1; s++) {
            const t = s / SR;
            const env = Math.min(1, (t - t0) / 1.6, (t1 - t) / 1.6);
            if (env <= 0) { ph += w; continue; }
            const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.11 * t + ni);
            const v = Math.sin(ph) * a * env * trem;
            L[s] += v * (1 - pan); R[s] += v * pan;
            ph += w;
          }
        }
      });
    });
    // sub bass
    const fb = midi(chord.root - 12), wb = (2 * Math.PI * fb) / SR;
    let pb = 0;
    for (let s = s0; s < s1; s++) {
      const t = s / SR, env = Math.max(0, Math.min(1, (t - t0) / 1.0, (t1 - t) / 1.0));
      const v = Math.sin(pb) * 0.07 * env; L[s] += v; R[s] += v; pb += wb;
    }
  }

  // --- arpeggio: soft bell plucks on eighth notes, entering after the intro
  const arpStart = 5.4;
  for (let k = 0; ; k++) {
    const t = arpStart + k * BEAT / 2;
    if (t > duration - 3) break;
    const chord = CHORDS[Math.floor(t / CHORD_LEN) % CHORDS.length];
    const pattern = [0, 2, 4, 3, 1, 3, 2, 4];
    const m = chord.notes[pattern[k % 8]] + 12;
    const f = midi(m), s0 = Math.floor(t * SR), len = Math.floor(1.6 * SR);
    const vel = (k % 2 ? 0.55 : 0.8) * 0.035, pan = 0.5 + 0.3 * Math.sin(k * 0.9);
    for (let i = 0; i < len && s0 + i < N; i++) {
      const tt = i / SR, env = Math.exp(-tt * 3.2) * Math.min(1, tt / 0.004);
      const v = (Math.sin(2 * Math.PI * f * tt) + 0.25 * Math.sin(2 * Math.PI * f * 2.01 * tt) * Math.exp(-tt * 6)) * vel * env;
      L[s0 + i] += v * (1 - pan); R[s0 + i] += v * pan;
    }
  }

  // --- swells: filtered noise rising into each scene cut (matches the scan-line wipe)
  const rand = rng(7);
  for (const cut of cuts.filter((c) => c > 0.5)) {
    const a = cut - 0.9, b = cut + 0.8;
    let lpL = 0, lpR = 0;
    for (let s = Math.max(0, Math.floor(a * SR)); s < Math.min(N, Math.floor(b * SR)); s++) {
      const t = s / SR;
      const rise = t < cut ? Math.pow((t - a) / (cut - a), 2.2) : Math.exp(-(t - cut) * 6);
      const k = 0.02 + 0.25 * rise;
      lpL += k * (rand() * 2 - 1 - lpL); lpR += k * (rand() * 2 - 1 - lpR);
      L[s] += lpL * 0.22 * rise; R[s] += lpR * 0.22 * rise;
    }
    // soft low thump on the cut
    for (let i = 0; i < 0.5 * SR; i++) {
      const s = Math.floor(cut * SR) + i; if (s >= N) break;
      const tt = i / SR, v = Math.sin(2 * Math.PI * (70 - 30 * tt) * tt) * Math.exp(-tt * 9) * 0.12;
      L[s] += v; R[s] += v;
    }
  }

  // --- master: fades, gentle saturation, normalise to -3 dBFS
  let peak = 0;
  for (let s = 0; s < N; s++) {
    const t = s / SR, fade = Math.min(1, t / 1.5, (duration - t) / 2.5);
    L[s] = Math.tanh(L[s] * 1.4) * fade; R[s] = Math.tanh(R[s] * 1.4) * fade;
    peak = Math.max(peak, Math.abs(L[s]), Math.abs(R[s]));
  }
  const gain = peak > 0 ? 0.708 / peak : 1;
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  for (let s = 0; s < N; s++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[s] * gain)) * 32767), 44 + s * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[s] * gain)) * 32767), 46 + s * 4);
  }
  fs.writeFileSync(file, buf);
}

if (process.argv[1] && process.argv[1].endsWith('audio.mjs')) {
  const d = Number(process.argv[2] || 30);
  writeSoundtrack('data/soundtrack-test.wav', d, [6, 11.4, 20]);
  console.log('wrote data/soundtrack-test.wav');
}
