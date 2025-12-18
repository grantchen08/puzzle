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

  let currentInstrument = 'flute';

  function setTuneByIndex(idx, silent) {
    if (!playlist || !playlist.length) return;
    const t = playlist[idx];
    if (!t) return;

    if (Array.isArray(t.melody)) melody = t.melody;
    if (Array.isArray(t.bass)) bass = t.bass;
    if (typeof t.tempo === 'number') setTempo(t.tempo);
    if (typeof t.instrument === 'string') currentInstrument = t.instrument;
    currentTuneName = t.name || `tune-${idx}`;
    melodyPos = 0;
    bassPos = 0;
    if (!silent) log(`Tune -> ${currentTuneName} (${currentInstrument})`);
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

  function playOscNote({ freq, instrument = 'flute', startTime, durationSec, gain }) {
    if (!ctx || !musicGain) return;

    // Route to appropriate instrument synthesis
    if (instrument === 'piano') {
      playPiano(freq, startTime, durationSec, gain);
    } else if (instrument === 'saxophone') {
      playSaxophone(freq, startTime, durationSec, gain);
    } else if (instrument === 'bell') {
      playBell(freq, startTime, durationSec, gain);
    } else {
      playFlute(freq, startTime, durationSec, gain);
    }
  }

  function playFlute(freq, startTime, durationSec, gain) {
    const masterAmp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000 + freq * 0.5, startTime);
    filter.Q.setValueAtTime(1, startTime);

    const osc1 = ctx.createOscillator();
    const amp1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, startTime);
    amp1.gain.setValueAtTime(0.6, startTime);
    
    const osc2 = ctx.createOscillator();
    const amp2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, startTime);
    amp2.gain.setValueAtTime(0.1, startTime);
    
    const osc3 = ctx.createOscillator();
    const amp3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(freq * 3, startTime);
    amp3.gain.setValueAtTime(0.15, startTime);

    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibrato.frequency.setValueAtTime(5, startTime);
    vibratoGain.gain.setValueAtTime(3, startTime);
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc1.frequency);
    vibratoGain.connect(osc2.frequency);
    vibratoGain.connect(osc3.frequency);

    const attack = 0.08;
    const release = Math.min(0.2, durationSec * 0.6);
    const sustainTime = Math.max(0, durationSec - attack - release);

    masterAmp.gain.setValueAtTime(0.0001, startTime);
    masterAmp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), startTime + attack);
    if (sustainTime > 0) {
      masterAmp.gain.setValueAtTime(Math.max(0.0002, gain), startTime + attack + sustainTime);
    }
    masterAmp.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc1.connect(amp1);
    osc2.connect(amp2);
    osc3.connect(amp3);
    amp1.connect(filter);
    amp2.connect(filter);
    amp3.connect(filter);
    filter.connect(masterAmp);
    masterAmp.connect(musicGain);

    osc1.start(startTime);
    osc2.start(startTime);
    osc3.start(startTime);
    vibrato.start(startTime);
    
    osc1.stop(startTime + durationSec + 0.02);
    osc2.stop(startTime + durationSec + 0.02);
    osc3.stop(startTime + durationSec + 0.02);
    vibrato.stop(startTime + durationSec + 0.02);
  }

  function playPiano(freq, startTime, durationSec, gain) {
    const masterAmp = ctx.createGain();
    
    // Piano has rich harmonics
    const osc1 = ctx.createOscillator();
    const amp1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, startTime);
    amp1.gain.setValueAtTime(0.5, startTime);
    
    const osc2 = ctx.createOscillator();
    const amp2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, startTime);
    amp2.gain.setValueAtTime(0.2, startTime);
    
    const osc3 = ctx.createOscillator();
    const amp3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(freq * 3, startTime);
    amp3.gain.setValueAtTime(0.1, startTime);
    
    const osc4 = ctx.createOscillator();
    const amp4 = ctx.createGain();
    osc4.type = 'sine';
    osc4.frequency.setValueAtTime(freq * 4.2, startTime);
    amp4.gain.setValueAtTime(0.08, startTime);

    // Piano has fast attack and exponential decay
    const attack = 0.002;
    const decay = Math.min(0.4, durationSec * 0.8);
    const sustainLevel = gain * 0.3;
    const sustainTime = Math.max(0, durationSec - attack - decay);

    masterAmp.gain.setValueAtTime(0.0001, startTime);
    masterAmp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), startTime + attack);
    masterAmp.gain.exponentialRampToValueAtTime(Math.max(0.0002, sustainLevel), startTime + attack + decay);
    if (sustainTime > 0) {
      masterAmp.gain.setValueAtTime(Math.max(0.0002, sustainLevel), startTime + attack + decay + sustainTime);
    }
    masterAmp.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc1.connect(amp1);
    osc2.connect(amp2);
    osc3.connect(amp3);
    osc4.connect(amp4);
    amp1.connect(masterAmp);
    amp2.connect(masterAmp);
    amp3.connect(masterAmp);
    amp4.connect(masterAmp);
    masterAmp.connect(musicGain);

    osc1.start(startTime);
    osc2.start(startTime);
    osc3.start(startTime);
    osc4.start(startTime);
    
    osc1.stop(startTime + durationSec + 0.02);
    osc2.stop(startTime + durationSec + 0.02);
    osc3.stop(startTime + durationSec + 0.02);
    osc4.stop(startTime + durationSec + 0.02);
  }

  function playSaxophone(freq, startTime, durationSec, gain) {
    const masterAmp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    
    // Saxophone has a brighter, more resonant sound
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800 + freq, startTime);
    filter.Q.setValueAtTime(2, startTime);

    // Sax has strong odd harmonics (reed instrument)
    const osc1 = ctx.createOscillator();
    const amp1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, startTime);
    amp1.gain.setValueAtTime(0.4, startTime);
    
    const osc2 = ctx.createOscillator();
    const amp2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 3, startTime);
    amp2.gain.setValueAtTime(0.3, startTime);
    
    const osc3 = ctx.createOscillator();
    const amp3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(freq * 5, startTime);
    amp3.gain.setValueAtTime(0.2, startTime);
    
    const osc4 = ctx.createOscillator();
    const amp4 = ctx.createGain();
    osc4.type = 'sine';
    osc4.frequency.setValueAtTime(freq * 7, startTime);
    amp4.gain.setValueAtTime(0.1, startTime);

    // Sax has strong vibrato
    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibrato.frequency.setValueAtTime(6, startTime);
    vibratoGain.gain.setValueAtTime(8, startTime);
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc1.frequency);
    vibratoGain.connect(osc2.frequency);
    vibratoGain.connect(osc3.frequency);
    vibratoGain.connect(osc4.frequency);

    const attack = 0.05;
    const release = Math.min(0.15, durationSec * 0.5);
    const sustainTime = Math.max(0, durationSec - attack - release);

    masterAmp.gain.setValueAtTime(0.0001, startTime);
    masterAmp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), startTime + attack);
    if (sustainTime > 0) {
      masterAmp.gain.setValueAtTime(Math.max(0.0002, gain), startTime + attack + sustainTime);
    }
    masterAmp.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc1.connect(amp1);
    osc2.connect(amp2);
    osc3.connect(amp3);
    osc4.connect(amp4);
    amp1.connect(filter);
    amp2.connect(filter);
    amp3.connect(filter);
    amp4.connect(filter);
    filter.connect(masterAmp);
    masterAmp.connect(musicGain);

    osc1.start(startTime);
    osc2.start(startTime);
    osc3.start(startTime);
    osc4.start(startTime);
    vibrato.start(startTime);
    
    osc1.stop(startTime + durationSec + 0.02);
    osc2.stop(startTime + durationSec + 0.02);
    osc3.stop(startTime + durationSec + 0.02);
    osc4.stop(startTime + durationSec + 0.02);
    vibrato.stop(startTime + durationSec + 0.02);
  }

  function playBell(freq, startTime, durationSec, gain) {
    const masterAmp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    
    // Bell has warm, resonant sound with emphasis on mids
    filter.type = 'peaking';
    filter.frequency.setValueAtTime(freq * 2, startTime);
    filter.Q.setValueAtTime(2, startTime);
    filter.gain.setValueAtTime(6, startTime);

    // Bell modes (inharmonic partials characteristic of bells)
    // Based on actual bell physics: hum tone, fundamental, minor third, fifth, octave
    const osc1 = ctx.createOscillator();
    const amp1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq * 0.5, startTime); // Hum tone
    amp1.gain.setValueAtTime(0.2, startTime);
    
    const osc2 = ctx.createOscillator();
    const amp2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq, startTime); // Fundamental (strike tone)
    amp2.gain.setValueAtTime(0.5, startTime);
    
    const osc3 = ctx.createOscillator();
    const amp3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(freq * 1.2, startTime); // Minor third
    amp3.gain.setValueAtTime(0.3, startTime);
    
    const osc4 = ctx.createOscillator();
    const amp4 = ctx.createGain();
    osc4.type = 'sine';
    osc4.frequency.setValueAtTime(freq * 1.5, startTime); // Fifth
    amp4.gain.setValueAtTime(0.25, startTime);
    
    const osc5 = ctx.createOscillator();
    const amp5 = ctx.createGain();
    osc5.type = 'sine';
    osc5.frequency.setValueAtTime(freq * 2, startTime); // Octave
    amp5.gain.setValueAtTime(0.15, startTime);

    // Fast attack with long, resonant decay (bell rings!)
    const attack = 0.003;
    const extendedDuration = Math.max(durationSec, 0.8); // Bells ring longer
    const decay = extendedDuration * 0.95;

    masterAmp.gain.setValueAtTime(0.0001, startTime);
    masterAmp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * 1.2), startTime + attack);
    masterAmp.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + decay);

    osc1.connect(amp1);
    osc2.connect(amp2);
    osc3.connect(amp3);
    osc4.connect(amp4);
    osc5.connect(amp5);
    amp1.connect(filter);
    amp2.connect(filter);
    amp3.connect(filter);
    amp4.connect(filter);
    amp5.connect(filter);
    filter.connect(masterAmp);
    masterAmp.connect(musicGain);

    osc1.start(startTime);
    osc2.start(startTime);
    osc3.start(startTime);
    osc4.start(startTime);
    osc5.start(startTime);
    
    const stopTime = startTime + extendedDuration + 0.02;
    osc1.stop(stopTime);
    osc2.stop(stopTime);
    osc3.stop(stopTime);
    osc4.stop(stopTime);
    osc5.stop(stopTime);
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
            instrument: currentInstrument,
            startTime: start,
            durationSec: durSec * 0.98,
            gain: 0.06,
          });
        }

        if (b && b.midi != null) {
          const bDurBeats = typeof b.dur === 'number' ? b.dur : 1;
          const bDurSec = bDurBeats * secondsPerBeat;
          playOscNote({
            freq: midiToFreq(b.midi),
            instrument: currentInstrument,
            startTime: start,
            durationSec: bDurSec * 0.95,
            gain: 0.04,
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

function jingleBells() {
  // Public domain (traditional Christmas). Key: C. Chorus only.
  return [
    // "Jingle bells, jingle bells, jingle all the way"
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 2 },
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 2 },
    { midi: 76, dur: 1 }, { midi: 79, dur: 1 }, { midi: 72, dur: 1.5 }, { midi: 74, dur: 0.5 },
    { midi: 76, dur: 4 },
    // "Oh what fun it is to ride in a one horse open sleigh"
    { midi: 77, dur: 1 }, { midi: 77, dur: 1 }, { midi: 77, dur: 1.5 }, { midi: 77, dur: 0.5 },
    { midi: 77, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 0.5 }, { midi: 76, dur: 0.5 },
    { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 },
    { midi: 74, dur: 2 }, { midi: 79, dur: 2 },
  ];
}

function weWishYouAMerryChristmas() {
  // Public domain (traditional Christmas). Key: C.
  return [
    // "We wish you a merry Christmas"
    { midi: 72, dur: 1 }, { midi: 77, dur: 1 }, { midi: 77, dur: 0.5 }, { midi: 78, dur: 0.5 },
    { midi: 77, dur: 0.5 }, { midi: 76, dur: 0.5 }, { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 74, dur: 1 },
    // "We wish you a merry Christmas"
    { midi: 74, dur: 1 }, { midi: 79, dur: 1 }, { midi: 79, dur: 0.5 }, { midi: 80, dur: 0.5 },
    { midi: 79, dur: 0.5 }, { midi: 77, dur: 0.5 }, { midi: 76, dur: 1 }, { midi: 72, dur: 1 }, { midi: 72, dur: 1 },
    // "We wish you a merry Christmas"
    { midi: 76, dur: 1 }, { midi: 81, dur: 1 }, { midi: 81, dur: 0.5 }, { midi: 82, dur: 0.5 },
    { midi: 81, dur: 0.5 }, { midi: 79, dur: 0.5 }, { midi: 77, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 1 },
    // "And a happy new year"
    { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 79, dur: 1 }, { midi: 77, dur: 1 },
    { midi: 76, dur: 2 }, { midi: 72, dur: 2 },
  ];
}

function deckTheHalls() {
  // Public domain (traditional Christmas). Key: F (transposed to C here).
  return [
    // "Deck the halls with boughs of holly"
    { midi: 72, dur: 1 }, { midi: 74, dur: 0.5 }, { midi: 76, dur: 0.5 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 },
    { midi: 74, dur: 1 }, { midi: 72, dur: 1 }, { midi: 71, dur: 1 }, { midi: 69, dur: 1 },
    // "Fa la la la la, la la la la"
    { midi: 69, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 1 },
    { midi: 74, dur: 2 }, { midi: 72, dur: 2 },
    // "'Tis the season to be jolly"
    { midi: 72, dur: 1 }, { midi: 74, dur: 0.5 }, { midi: 76, dur: 0.5 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 },
    { midi: 74, dur: 1 }, { midi: 72, dur: 1 }, { midi: 71, dur: 1 }, { midi: 69, dur: 1 },
    // "Fa la la la la, la la la la"
    { midi: 69, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 1 },
    { midi: 74, dur: 2 }, { midi: 72, dur: 2 },
  ];
}

function silentNight() {
  // Public domain (traditional Christmas). Key: C.
  return [
    // "Silent night, holy night"
    { midi: 79, dur: 1.5 }, { midi: 79, dur: 0.5 }, { midi: 76, dur: 2 },
    { midi: 79, dur: 1.5 }, { midi: 79, dur: 0.5 }, { midi: 76, dur: 2 },
    // "All is calm, all is bright"
    { midi: 83, dur: 1.5 }, { midi: 83, dur: 0.5 }, { midi: 81, dur: 2 },
    { midi: 79, dur: 1.5 }, { midi: 79, dur: 0.5 }, { midi: 77, dur: 2 },
    // "Round yon virgin mother and child"
    { midi: 72, dur: 1.5 }, { midi: 72, dur: 0.5 }, { midi: 79, dur: 1.5 }, { midi: 77, dur: 0.5 },
    { midi: 76, dur: 2 },
    // "Holy infant so tender and mild"
    { midi: 72, dur: 1.5 }, { midi: 72, dur: 0.5 }, { midi: 79, dur: 1.5 }, { midi: 77, dur: 0.5 },
    { midi: 76, dur: 2 },
    // "Sleep in heavenly peace"
    { midi: 81, dur: 1.5 }, { midi: 81, dur: 0.5 }, { midi: 83, dur: 2 },
    { midi: 79, dur: 1.5 }, { midi: 77, dur: 0.5 }, { midi: 76, dur: 2.5 }, { midi: 74, dur: 0.5 },
    // "Sleep in heavenly peace"
    { midi: 72, dur: 4 },
  ];
}

function joyToTheWorld() {
  // Public domain (traditional Christmas). Key: C.
  return [
    // "Joy to the world, the Lord is come"
    { midi: 84, dur: 1.5 }, { midi: 83, dur: 0.5 }, { midi: 81, dur: 1 }, { midi: 79, dur: 1 },
    { midi: 77, dur: 1.5 }, { midi: 76, dur: 0.5 }, { midi: 74, dur: 1 }, { midi: 72, dur: 1 },
    // "Let earth receive her King"
    { midi: 69, dur: 1 }, { midi: 69, dur: 1 }, { midi: 71, dur: 1.5 }, { midi: 72, dur: 0.5 },
    { midi: 72, dur: 2 },
    // "Let every heart prepare Him room"
    { midi: 79, dur: 1 }, { midi: 79, dur: 1 }, { midi: 79, dur: 1 }, { midi: 77, dur: 1 },
    { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 },
    // "And heaven and nature sing"
    { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 },
    { midi: 79, dur: 2 }, { midi: 84, dur: 2 },
  ];
}

function publicDomainTunes() {
  // Provide a ready-to-use shuffled playlist source with different instruments.
  return [
    { name: 'Twinkle Twinkle Little Star', melody: twinkleTwinkle(), tempo: 100, instrument: 'flute' },
    { name: 'Frère Jacques', melody: frereJacques(), tempo: 105, instrument: 'piano' },
    { name: 'Mary Had a Little Lamb', melody: maryHadALittleLamb(), tempo: 110, instrument: 'bell' },
    { name: 'Ode to Joy', melody: odeToJoy(), tempo: 100, instrument: 'saxophone' },
    { name: 'Row Row Row Your Boat', melody: rowRowRowYourBoat(), tempo: 95, instrument: 'flute' },
    { name: 'Jingle Bells', melody: jingleBells(), tempo: 110, instrument: 'bell' },
    { name: 'We Wish You a Merry Christmas', melody: weWishYouAMerryChristmas(), tempo: 120, instrument: 'flute' },
    { name: 'Deck the Halls', melody: deckTheHalls(), tempo: 115, instrument: 'piano' },
    { name: 'Silent Night', melody: silentNight(), tempo: 80, instrument: 'saxophone' },
    { name: 'Joy to the World', melody: joyToTheWorld(), tempo: 100, instrument: 'bell' },
    { name: 'Twinkle Twinkle Little Star', melody: twinkleTwinkle(), tempo: 105, instrument: 'piano' },
    { name: 'Frère Jacques', melody: frereJacques(), tempo: 100, instrument: 'saxophone' },
    { name: 'Mary Had a Little Lamb', melody: maryHadALittleLamb(), tempo: 115, instrument: 'flute' },
    { name: 'Ode to Joy', melody: odeToJoy(), tempo: 95, instrument: 'piano' },
    { name: 'Row Row Row Your Boat', melody: rowRowRowYourBoat(), tempo: 100, instrument: 'bell' },
  ];
}

const melodies = {
  twinkleTwinkle,
  frereJacques,
  maryHadALittleLamb,
  odeToJoy,
  rowRowRowYourBoat,
  jingleBells,
  weWishYouAMerryChristmas,
  deckTheHalls,
  silentNight,
  joyToTheWorld,
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
