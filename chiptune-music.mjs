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
  let playlist = Array.isArray(options.playlist) ? options.playlist : null; // [{ name, melody, bass?, tempo? }, ...]
  let shufflePlaylist = !!options.shufflePlaylist;
  let playlistOrder = null;
  let playlistPos = 0;
  let currentTuneName = null;

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
  let melodyPos = 0;
  let bassPos = 0;
  let nextNoteTime = 0;

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function initPlaylistIfNeeded() {
    if (!playlist || !playlist.length) return;
    if (!playlistOrder) {
      playlistOrder = Array.from({ length: playlist.length }, (_, i) => i);
      if (shufflePlaylist) shuffleArray(playlistOrder);
      playlistPos = 0;
    }
    if (!melody.length) {
      setTuneByIndex(playlistOrder[playlistPos], true);
    }
  }

  function setTuneByIndex(idx, silent) {
    if (!playlist || !playlist.length) return;
    const t = playlist[idx];
    if (!t) return;

    if (Array.isArray(t.melody)) melody = t.melody;
    if (Array.isArray(t.bass)) bass = t.bass;
    if (typeof t.tempo === 'number') setTempo(t.tempo);
    currentTuneName = t.name || `tune-${idx}`;
    melodyPos = 0;
    bassPos = 0;
    if (!silent) log(`Tune -> ${currentTuneName}`);
  }

  function nextTune() {
    if (!playlist || !playlist.length) return;
    initPlaylistIfNeeded();
    if (!playlistOrder) return;

    playlistPos++;
    if (playlistPos >= playlistOrder.length) {
      playlistPos = 0;
      if (shufflePlaylist) shuffleArray(playlistOrder);
    }
    setTuneByIndex(playlistOrder[playlistPos], false);
  }

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

  function setPlaylist(pl, shuffle) {
    playlist = Array.isArray(pl) ? pl : null;
    shufflePlaylist = !!shuffle;
    playlistOrder = null;
    playlistPos = 0;
    currentTuneName = null;

    if (playlist && playlist.length) {
      initPlaylistIfNeeded();
      log(`Playlist set (${playlist.length} tunes${shufflePlaylist ? ', shuffled' : ''})`);
    } else {
      log('Playlist cleared');
    }
  }

  function playOscNote({ freq, type, startTime, durationSec, gain }) {
    if (!ctx || !musicGain) return;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    // Gentle attack + longer release for smooth, soothing sound.
    const attack = 0.02; // Slower attack for softer onset
    const release = Math.min(0.15, durationSec * 0.5); // Longer release for smooth fade
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
        const m = melody.length ? melody[melodyPos] : null;
        const b = bass.length ? bass[bassPos] : null;

        const start = nextNoteTime;
        const durBeats = m && typeof m.dur === 'number' ? m.dur : 1;
        const durSec = durBeats * secondsPerBeat;

        if (m && m.midi != null) {
          playOscNote({
            freq: midiToFreq(m.midi),
            type: 'sine', // Sine wave for smooth, mellow tone
            startTime: start,
            durationSec: durSec * 0.98,
            gain: 0.06, // Slightly reduced for gentler sound
          });
        }

        if (b && b.midi != null) {
          const bDurBeats = typeof b.dur === 'number' ? b.dur : 1;
          const bDurSec = bDurBeats * secondsPerBeat;
          playOscNote({
            freq: midiToFreq(b.midi),
            type: 'sine', // Sine wave for smooth bass
            startTime: start,
            durationSec: bDurSec * 0.95,
            gain: 0.04, // Slightly reduced for subtler accompaniment
          });
        }

        nextNoteTime += durSec;

        if (melody.length) {
          melodyPos++;
          if (melodyPos >= melody.length) {
            melodyPos = 0;
            if (playlist) nextTune();
          }
        }
        if (bass.length) {
          bassPos++;
          if (bassPos >= bass.length) bassPos = 0;
        }
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

    initPlaylistIfNeeded();

    isPlaying = true;
    melodyPos = 0;
    bassPos = 0;
    nextNoteTime = ctx.currentTime + 0.05;
    timerId = setInterval(schedule, lookaheadMs);
    log(`Music started (ctxState=${ctx.state}, tempo=${tempo}${currentTuneName ? `, tune=${currentTuneName}` : ''})`);
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
      tune: currentTuneName,
      playlistSize: playlist ? playlist.length : 0,
      playlistIndex: playlist ? playlistPos : 0,
      playlistShuffled: !!shufflePlaylist,
      melodyPos,
      bassPos,
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
    setPlaylist,
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

function maryHadALittleLamb() {
  return [
    { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 },
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 2 },
    { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 74, dur: 2 },
    { midi: 76, dur: 1 }, { midi: 79, dur: 1 }, { midi: 79, dur: 2 },
    { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 },
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 },
    { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 },
    { midi: 72, dur: 4 },
  ];
}

function frereJacques() {
  return [
    { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 }, { midi: 72, dur: 1 },
    { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 }, { midi: 72, dur: 1 },
    { midi: 76, dur: 1 }, { midi: 77, dur: 1 }, { midi: 79, dur: 2 },
    { midi: 76, dur: 1 }, { midi: 77, dur: 1 }, { midi: 79, dur: 2 },
    { midi: 79, dur: 0.5 }, { midi: 81, dur: 0.5 }, { midi: 79, dur: 0.5 }, { midi: 77, dur: 0.5 },
    { midi: 76, dur: 1 }, { midi: 72, dur: 1 },
    { midi: 79, dur: 0.5 }, { midi: 81, dur: 0.5 }, { midi: 79, dur: 0.5 }, { midi: 77, dur: 0.5 },
    { midi: 76, dur: 1 }, { midi: 72, dur: 1 },
    { midi: 72, dur: 1 }, { midi: 67, dur: 1 }, { midi: 72, dur: 2 },
  ];
}

function odeToJoy() {
  return [
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 77, dur: 1 }, { midi: 79, dur: 1 },
    { midi: 79, dur: 1 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 },
    { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 },
    { midi: 76, dur: 1.5 }, { midi: 74, dur: 0.5 }, { midi: 74, dur: 2 },
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 77, dur: 1 }, { midi: 79, dur: 1 },
    { midi: 79, dur: 1 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 },
    { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 },
    { midi: 74, dur: 1.5 }, { midi: 72, dur: 0.5 }, { midi: 72, dur: 2 },
  ];
}

function rowRowRowYourBoat() {
  return [
    { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 },
    { midi: 76, dur: 2 },
    { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 }, { midi: 77, dur: 1 },
    { midi: 79, dur: 2 },
    { midi: 84, dur: 0.5 }, { midi: 84, dur: 0.5 }, { midi: 84, dur: 0.5 }, { midi: 84, dur: 0.5 },
    { midi: 79, dur: 0.5 }, { midi: 79, dur: 0.5 }, { midi: 79, dur: 0.5 }, { midi: 79, dur: 0.5 },
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 74, dur: 1 },
    { midi: 72, dur: 4 },
  ];
}

function publicDomainTunes() {
  return [
    { name: 'Twinkle Twinkle Little Star', melody: twinkleTwinkle(), tempo: 100 }, // Slower, more peaceful
    { name: 'Frère Jacques', melody: frereJacques(), tempo: 105 },
    { name: 'Mary Had a Little Lamb', melody: maryHadALittleLamb(), tempo: 110 },
    { name: 'Ode to Joy', melody: odeToJoy(), tempo: 100 },
    { name: 'Row Row Row Your Boat', melody: rowRowRowYourBoat(), tempo: 95 },
  ];
}

const melodies = {
  twinkleTwinkle,
  frereJacques,
  maryHadALittleLamb,
  odeToJoy,
  rowRowRowYourBoat,
};

const bassPatterns = {
  simple: simpleBass,
};

const tunes = {
  publicDomain: publicDomainTunes,
};

const ChiptuneMusic = {
  createPlayer,
  midiToFreq,
  melodies,
  bassPatterns,
  tunes,
};

export { createPlayer, midiToFreq, melodies, bassPatterns, tunes };
export default ChiptuneMusic;
