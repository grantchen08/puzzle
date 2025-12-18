/*
  ChiptuneMusic (ESM)

  ESM-friendly version of the tiny Web Audio background-music helper.

  Usage:
    import ChiptuneMusic, { createPlayer, melodies, bassPatterns } from './chiptune-music.mjs';

    const player = createPlayer({
      melody: melodies.twinkleTwinkle(),
      bass: bassPatterns.simple(),
      tempo: 120,
      volume: 0.22,
      log: console.log,
    });

    // After a user gesture:
    await player.unlock();
    player.start();
*/

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function defaultLog() {}

function createPlayer(options = {}) {
  const log = typeof options.log === 'function' ? options.log : defaultLog;

  let melody = Array.isArray(options.melody) ? options.melody : [];
  let bass = Array.isArray(options.bass) ? options.bass : [];

  let tempo = typeof options.tempo === 'number' ? options.tempo : 120;
  const lookaheadMs = typeof options.lookaheadMs === 'number' ? options.lookaheadMs : 25;
  const scheduleAheadSec = typeof options.scheduleAheadSec === 'number' ? options.scheduleAheadSec : 0.12;

  let ctx = null;
  let masterGain = null;
  let musicGain = null;

  let volume = typeof options.volume === 'number' ? clamp01(options.volume) : 0.22;

  let enabled = true;
  let muted = false;

  let isPlaying = false;
  let timerId = null;
  let step = 0;
  let nextNoteTime = 0;

  function ensure() {
    if (ctx) return true;

    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) {
      log('Web Audio API not supported (no AudioContext)');
      return false;
    }

    ctx = new Ctx();
    masterGain = ctx.createGain();
    musicGain = ctx.createGain();

    musicGain.gain.value = volume;
    masterGain.gain.value = muted ? 0 : 1;

    musicGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    ctx.onstatechange = () => {
      log(`AudioContext state -> ${ctx.state}`);
    };

    log(`AudioContext created (state=${ctx.state})`);
    return true;
  }

  function setVolume(v) {
    volume = clamp01(typeof v === 'number' ? v : volume);
    if (musicGain && ctx) {
      musicGain.gain.setValueAtTime(volume, ctx.currentTime);
    }
  }

  function setMuted(m) {
    muted = !!m;
    if (masterGain && ctx) {
      masterGain.gain.setValueAtTime(muted ? 0 : 1, ctx.currentTime);
    }
    if (muted) stop();
  }

  function setEnabled(e) {
    enabled = !!e;
    if (!enabled) stop();
  }

  function setTempo(bpm) {
    if (typeof bpm === 'number' && bpm > 20 && bpm < 400) {
      tempo = bpm;
    }
  }

  function setSequence(seq) {
    if (!seq) return;
    if (Array.isArray(seq.melody)) melody = seq.melody;
    if (Array.isArray(seq.bass)) bass = seq.bass;
    if (typeof seq.tempo === 'number') setTempo(seq.tempo);
  }

  function playOscNote({ freq, type, startTime, durationSec, gain }) {
    if (!ctx || !musicGain) return;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    const attack = 0.005;
    const release = Math.min(0.06, durationSec * 0.35);
    const sustainTime = Math.max(0, durationSec - attack - release);

    amp.gain.setValueAtTime(0.0001, startTime);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), startTime + attack);
    if (sustainTime > 0) {
      amp.gain.setValueAtTime(Math.max(0.0002, gain), startTime + attack + sustainTime);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(amp);
    amp.connect(musicGain);

    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.02);
  }

  function schedule() {
    if (!ctx || !isPlaying) return;

    try {
      const secondsPerBeat = 60 / tempo;

      while (nextNoteTime < ctx.currentTime + scheduleAheadSec) {
        const m = melody.length ? melody[step % melody.length] : null;
        const b = bass.length ? bass[step % bass.length] : null;

        const start = nextNoteTime;
        const durBeats = m && typeof m.dur === 'number' ? m.dur : 1;
        const durSec = durBeats * secondsPerBeat;

        if (m && m.midi != null) {
          playOscNote({
            freq: midiToFreq(m.midi),
            type: 'square',
            startTime: start,
            durationSec: durSec * 0.98,
            gain: 0.08,
          });
        }

        if (b && b.midi != null) {
          const bDurBeats = typeof b.dur === 'number' ? b.dur : 1;
          const bDurSec = bDurBeats * secondsPerBeat;
          playOscNote({
            freq: midiToFreq(b.midi),
            type: 'triangle',
            startTime: start,
            durationSec: bDurSec * 0.95,
            gain: 0.05,
          });
        }

        nextNoteTime += durSec;
        step++;
      }
    } catch (e) {
      log(`schedule error: ${e && e.message ? e.message : e}`);
      stop();
    }
  }

  async function unlock() {
    if (!ensure()) return false;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
        log('AudioContext resume() ok');
        return true;
      } catch (e) {
        log(`AudioContext resume() failed: ${e && e.message ? e.message : e}`);
        return false;
      }
    }

    return true;
  }

  function start() {
    if (isPlaying) return;
    if (!enabled) {
      log('start skipped: disabled');
      return;
    }
    if (muted) {
      log('start skipped: muted');
      return;
    }
    if (!ensure()) return;

    // Try to resume, but don't block scheduling on it.
    unlock();

    isPlaying = true;
    step = 0;
    nextNoteTime = ctx.currentTime + 0.05;
    timerId = setInterval(schedule, lookaheadMs);
    log(`Music started (ctxState=${ctx.state}, tempo=${tempo})`);
  }

  function stop() {
    if (!isPlaying) return;
    isPlaying = false;
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    log('Music stopped');
  }

  function destroy() {
    stop();
    if (ctx && typeof ctx.close === 'function') {
      try { ctx.close(); } catch {}
    }
    ctx = null;
    masterGain = null;
    musicGain = null;
  }

  function getState() {
    return {
      ctxState: ctx ? ctx.state : null,
      enabled,
      muted,
      isPlaying,
      tempo,
      volume,
      melodyLength: melody.length,
      bassLength: bass.length,
    };
  }

  return {
    ensure,
    unlock,
    start,
    stop,
    destroy,
    setMuted,
    setEnabled,
    setVolume,
    setTempo,
    setSequence,
    getState,
  };
}

function twinkleTwinkle() {
  return [
    { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 79, dur: 1 }, { midi: 79, dur: 1 },
    { midi: 81, dur: 1 }, { midi: 81, dur: 1 }, { midi: 79, dur: 2 },
    { midi: 77, dur: 1 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 },
    { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 2 },
    { midi: 79, dur: 1 }, { midi: 79, dur: 1 }, { midi: 77, dur: 1 }, { midi: 77, dur: 1 },
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 2 },
    { midi: 79, dur: 1 }, { midi: 79, dur: 1 }, { midi: 77, dur: 1 }, { midi: 77, dur: 1 },
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 2 },
    { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 79, dur: 1 }, { midi: 79, dur: 1 },
    { midi: 81, dur: 1 }, { midi: 81, dur: 1 }, { midi: 79, dur: 2 },
    { midi: 77, dur: 1 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 },
    { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 2 },
  ];
}

function simpleBass() {
  return [
    { midi: 52, dur: 1 }, { midi: 52, dur: 1 }, { midi: 55, dur: 1 }, { midi: 55, dur: 1 },
    { midi: 57, dur: 1 }, { midi: 57, dur: 1 }, { midi: 55, dur: 1 }, { midi: 55, dur: 1 },
  ];
}

const melodies = {
  twinkleTwinkle,
};

const bassPatterns = {
  simple: simpleBass,
};

const ChiptuneMusic = {
  createPlayer,
  midiToFreq,
  melodies,
  bassPatterns,
};

export { createPlayer, midiToFreq, melodies, bassPatterns };
export default ChiptuneMusic;
