/*
  ChiptuneMusic - tiny Web Audio background-music helper

  Goals:
  - No build step, no dependencies
  - Works via <script src="chiptune-music.js"></script>
  - Reusable API for other projects

  Usage:
    const player = ChiptuneMusic.createPlayer({
      melody: ChiptuneMusic.melodies.twinkleTwinkle(),
      bass: ChiptuneMusic.bassPatterns.simple(),
      tempo: 120,
      volume: 0.22,
      log: (msg) => console.log(msg)
    });

    // After a user gesture:
    await player.unlock();
    player.start();

    // Settings:
    player.setMuted(true/false);
    player.setEnabled(true/false);
    player.setVolume(0.1);
    player.stop();

  Notes:
  - Browsers often require a user gesture to start/resume AudioContext.
  - This module synthesizes sound; it does not load audio files.
*/

(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.ChiptuneMusic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function clamp01(x) {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function defaultLog() {}

  function createPlayer(options) {
    var opts = options || {};

    var log = typeof opts.log === 'function' ? opts.log : defaultLog;

    var melody = Array.isArray(opts.melody) ? opts.melody : [];
    var bass = Array.isArray(opts.bass) ? opts.bass : [];
    var playlist = Array.isArray(opts.playlist) ? opts.playlist : null; // [{ name, melody, bass?, tempo? }, ...]
    var shufflePlaylist = !!opts.shufflePlaylist;
    var playlistOrder = null;
    var playlistPos = 0;
    var currentTuneName = null;

    var tempo = typeof opts.tempo === 'number' ? opts.tempo : 120;
    var lookaheadMs = typeof opts.lookaheadMs === 'number' ? opts.lookaheadMs : 25;
    var scheduleAheadSec = typeof opts.scheduleAheadSec === 'number' ? opts.scheduleAheadSec : 0.12;

    var ctx = null;
    var masterGain = null;
    var musicGain = null;

    var volume = typeof opts.volume === 'number' ? clamp01(opts.volume) : 0.22;

    var enabled = true;
    var muted = false;

    var isPlaying = false;
    var timerId = null;
    var step = 0;
    var nextNoteTime = 0;

    function shuffleArray(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    }

    function initPlaylistIfNeeded() {
      if (!playlist || !playlist.length) return;
      if (!playlistOrder) {
        playlistOrder = [];
        for (var i = 0; i < playlist.length; i++) playlistOrder.push(i);
        if (shufflePlaylist) shuffleArray(playlistOrder);
        playlistPos = 0;
      }
      // If no melody provided explicitly, seed from playlist.
      if (!melody.length) {
        setTuneByIndex(playlistOrder[playlistPos], true);
      }
    }

    function setTuneByIndex(idx, silent) {
      if (!playlist || !playlist.length) return;
      var t = playlist[idx];
      if (!t) return;

      if (Array.isArray(t.melody)) melody = t.melody;
      if (Array.isArray(t.bass)) bass = t.bass;
      if (typeof t.tempo === 'number') setTempo(t.tempo);
      currentTuneName = t.name || ('tune-' + idx);
      step = 0;
      if (!silent) log('Tune -> ' + currentTuneName);
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

      var Ctx = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
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

      ctx.onstatechange = function () {
        log('AudioContext state -> ' + ctx.state);
      };

      log('AudioContext created (state=' + ctx.state + ')');
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
      // If we're currently playing, switch immediately.
      if (playlist && playlist.length) {
        initPlaylistIfNeeded();
        log('Playlist set (' + playlist.length + ' tunes' + (shufflePlaylist ? ', shuffled' : '') + ')');
      } else {
        log('Playlist cleared');
      }
    }

    function playOscNote(note) {
      if (!ctx || !musicGain) return;

      var freq = note.freq;
      var type = note.type;
      var startTime = note.startTime;
      var durationSec = note.durationSec;
      var gain = note.gain;

      var osc = ctx.createOscillator();
      var amp = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      // Quick attack + short release for classic bleep feel.
      var attack = 0.005;
      var release = Math.min(0.06, durationSec * 0.35);
      var sustainTime = Math.max(0, durationSec - attack - release);

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
        var secondsPerBeat = 60 / tempo;

        while (nextNoteTime < ctx.currentTime + scheduleAheadSec) {
          // If using a playlist, advance tune on wrap-around.
          if (playlist && melody.length && step > 0 && (step % melody.length === 0)) {
            nextTune();
          }

          var m = melody.length ? melody[step % melody.length] : null;
          var b = bass.length ? bass[step % bass.length] : null;

          var start = nextNoteTime;
          var durBeats = (m && typeof m.dur === 'number') ? m.dur : 1;
          var durSec = durBeats * secondsPerBeat;

          if (m && m.midi != null) {
            playOscNote({
              freq: midiToFreq(m.midi),
              type: 'square',
              startTime: start,
              durationSec: durSec * 0.98,
              gain: 0.08
            });
          }

          if (b && b.midi != null) {
            var bDurBeats = (typeof b.dur === 'number') ? b.dur : 1;
            var bDurSec = bDurBeats * secondsPerBeat;
            playOscNote({
              freq: midiToFreq(b.midi),
              type: 'triangle',
              startTime: start,
              durationSec: bDurSec * 0.95,
              gain: 0.05
            });
          }

          nextNoteTime += durSec;
          step++;
        }
      } catch (e) {
        log('schedule error: ' + (e && e.message ? e.message : e));
        stop();
      }
    }

    function unlock() {
      if (!ensure()) return Promise.resolve(false);

      // Resume context if needed (autoplay policies).
      if (ctx.state === 'suspended') {
        return ctx.resume().then(function () {
          log('AudioContext resume() ok');
          return true;
        }).catch(function (e) {
          log('AudioContext resume() failed: ' + (e && e.message ? e.message : e));
          return false;
        });
      }

      return Promise.resolve(true);
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
      step = 0;
      nextNoteTime = ctx.currentTime + 0.05;
      timerId = setInterval(schedule, lookaheadMs);
      log('Music started (ctxState=' + ctx.state + ', tempo=' + tempo + (currentTuneName ? ', tune=' + currentTuneName : '') + ')');
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
        try { ctx.close(); } catch (e) {}
      }
      ctx = null;
      masterGain = null;
      musicGain = null;
    }

    function getState() {
      return {
        ctxState: ctx ? ctx.state : null,
        enabled: enabled,
        muted: muted,
        isPlaying: isPlaying,
        tempo: tempo,
        volume: volume,
        melodyLength: melody.length,
        bassLength: bass.length,
        tune: currentTuneName,
        playlistSize: playlist ? playlist.length : 0,
        playlistIndex: playlist ? playlistPos : 0,
        playlistShuffled: !!shufflePlaylist
      };
    }

    return {
      ensure: ensure,
      unlock: unlock,
      start: start,
      stop: stop,
      destroy: destroy,
      setMuted: setMuted,
      setEnabled: setEnabled,
      setVolume: setVolume,
      setTempo: setTempo,
      setSequence: setSequence,
      setPlaylist: setPlaylist,
      getState: getState
    };
  }

  // --- Built-in sequences (optional convenience) ---
  function twinkleTwinkle() {
    return [
      // Phrase 1: C C G G A A G(hold)
      { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 79, dur: 1 }, { midi: 79, dur: 1 },
      { midi: 81, dur: 1 }, { midi: 81, dur: 1 }, { midi: 79, dur: 2 },
      // Phrase 2: F F E E D D C(hold)
      { midi: 77, dur: 1 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 },
      { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 2 },
      // Phrase 3: G G F F E E D(hold)
      { midi: 79, dur: 1 }, { midi: 79, dur: 1 }, { midi: 77, dur: 1 }, { midi: 77, dur: 1 },
      { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 2 },
      // Phrase 4: G G F F E E D(hold)
      { midi: 79, dur: 1 }, { midi: 79, dur: 1 }, { midi: 77, dur: 1 }, { midi: 77, dur: 1 },
      { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 2 },
      // Phrase 5: C C G G A A G(hold)
      { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 79, dur: 1 }, { midi: 79, dur: 1 },
      { midi: 81, dur: 1 }, { midi: 81, dur: 1 }, { midi: 79, dur: 2 },
      // Phrase 6: F F E E D D C(hold)
      { midi: 77, dur: 1 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 },
      { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 2 }
    ];
  }

  function simpleBass() {
    return [
      { midi: 52, dur: 1 }, { midi: 52, dur: 1 }, { midi: 55, dur: 1 }, { midi: 55, dur: 1 },
      { midi: 57, dur: 1 }, { midi: 57, dur: 1 }, { midi: 55, dur: 1 }, { midi: 55, dur: 1 }
    ];
  }

  function maryHadALittleLamb() {
    // Public domain (traditional). Key: C.
    return [
      { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 },
      { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 2 },
      { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 74, dur: 2 },
      { midi: 76, dur: 1 }, { midi: 79, dur: 1 }, { midi: 79, dur: 2 },
      { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 },
      { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 76, dur: 1 },
      { midi: 74, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 },
      { midi: 72, dur: 4 }
    ];
  }

  function frereJacques() {
    // Public domain (traditional). Key: C.
    return [
      { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 }, { midi: 72, dur: 1 },
      { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 }, { midi: 72, dur: 1 },
      { midi: 76, dur: 1 }, { midi: 77, dur: 1 }, { midi: 79, dur: 2 },
      { midi: 76, dur: 1 }, { midi: 77, dur: 1 }, { midi: 79, dur: 2 },
      { midi: 79, dur: 0.5 }, { midi: 81, dur: 0.5 }, { midi: 79, dur: 0.5 }, { midi: 77, dur: 0.5 },
      { midi: 76, dur: 1 }, { midi: 72, dur: 1 },
      { midi: 79, dur: 0.5 }, { midi: 81, dur: 0.5 }, { midi: 79, dur: 0.5 }, { midi: 77, dur: 0.5 },
      { midi: 76, dur: 1 }, { midi: 72, dur: 1 },
      { midi: 72, dur: 1 }, { midi: 67, dur: 1 }, { midi: 72, dur: 2 } // end cadence
    ];
  }

  function odeToJoy() {
    // Beethoven (public domain). Key: C-ish (starting on E).
    return [
      { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 77, dur: 1 }, { midi: 79, dur: 1 },
      { midi: 79, dur: 1 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 },
      { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 },
      { midi: 76, dur: 1.5 }, { midi: 74, dur: 0.5 }, { midi: 74, dur: 2 },
      { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 77, dur: 1 }, { midi: 79, dur: 1 },
      { midi: 79, dur: 1 }, { midi: 77, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 },
      { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 },
      { midi: 74, dur: 1.5 }, { midi: 72, dur: 0.5 }, { midi: 72, dur: 2 }
    ];
  }

  function rowRowRowYourBoat() {
    // Public domain (traditional). Key: C.
    return [
      { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 72, dur: 1 }, { midi: 74, dur: 1 },
      { midi: 76, dur: 2 },
      { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 76, dur: 1 }, { midi: 77, dur: 1 },
      { midi: 79, dur: 2 },
      { midi: 84, dur: 0.5 }, { midi: 84, dur: 0.5 }, { midi: 84, dur: 0.5 }, { midi: 84, dur: 0.5 },
      { midi: 79, dur: 0.5 }, { midi: 79, dur: 0.5 }, { midi: 79, dur: 0.5 }, { midi: 79, dur: 0.5 },
      { midi: 76, dur: 1 }, { midi: 76, dur: 1 }, { midi: 74, dur: 1 }, { midi: 74, dur: 1 },
      { midi: 72, dur: 4 }
    ];
  }

  function publicDomainTunes() {
    // Provide a ready-to-use shuffled playlist source.
    return [
      { name: 'Twinkle Twinkle Little Star', melody: twinkleTwinkle(), tempo: 120 },
      { name: 'Frère Jacques', melody: frereJacques(), tempo: 120 },
      { name: 'Mary Had a Little Lamb', melody: maryHadALittleLamb(), tempo: 132 },
      { name: 'Ode to Joy', melody: odeToJoy(), tempo: 120 },
      { name: 'Row Row Row Your Boat', melody: rowRowRowYourBoat(), tempo: 120 }
    ];
  }

  return {
    createPlayer: createPlayer,
    midiToFreq: midiToFreq,
    melodies: {
      twinkleTwinkle: twinkleTwinkle,
      frereJacques: frereJacques,
      maryHadALittleLamb: maryHadALittleLamb,
      odeToJoy: odeToJoy,
      rowRowRowYourBoat: rowRowRowYourBoat
    },
    bassPatterns: {
      simple: simpleBass
    },
    tunes: {
      publicDomain: publicDomainTunes
    }
  };
});
