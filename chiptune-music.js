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

      isPlaying = true;
      step = 0;
      nextNoteTime = ctx.currentTime + 0.05;
      timerId = setInterval(schedule, lookaheadMs);
      log('Music started (ctxState=' + ctx.state + ', tempo=' + tempo + ')');
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
        bassLength: bass.length
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

  return {
    createPlayer: createPlayer,
    midiToFreq: midiToFreq,
    melodies: {
      twinkleTwinkle: twinkleTwinkle
    },
    bassPatterns: {
      simple: simpleBass
    }
  };
});
