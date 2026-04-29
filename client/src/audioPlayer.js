/**
 * CustomPianoPlayer  –  implements the InstrumentPlayer interface expected by
 * osmd-audio-player's PlaybackEngine (v0.7.0).
 *
 * Every MIDI program number is routed through a single Acoustic Grand Piano
 * soundfont so the score always sounds like piano regardless of the instrument
 * definitions in the MusicXML file.
 *
 * Per-part muting is handled by tracking which MIDI IDs are silenced.
 *
 * Implementation notes:
 * - `instruments` is pre-populated with all 128 MIDI IDs in the constructor so
 *   PlaybackEngine.loadInstruments() can always find an entry and never calls
 *   fallbackToPiano() (which would collapse all IDs to 0 and emit console.warn).
 * - `init()` intentionally does NOT reset `instruments`, because PlaybackEngine
 *   captures `this.instrumentPlayer.instruments` as `availableInstruments`
 *   immediately after calling `init()`.
 */
import Soundfont from 'soundfont-player';

export class CustomPianoPlayer {
  constructor() {
    // Pre-populate with all 128 MIDI program IDs.
    // PlaybackEngine.loadInstruments() checks this list; every entry must exist
    // or it resets the instrument's MidiInstrumentId to 0 with a console.warn.
    /** @type {{ midiId: number; name: string; loaded: boolean }[]} */
    this.instruments = Array.from({ length: 128 }, (_, i) => ({
      midiId: i,
      name: 'Piano',
      loaded: false,
    }));
    this._piano = null;       // soundfont-player player instance
    this._ac = null;          // AudioContext (provided by PlaybackEngine)
    this._mutedIds = new Set(); // set of muted midiIds
  }

  /**
   * Called by PlaybackEngine constructor.
   * NOTE: do NOT reset `this.instruments` here — see class-level comment.
   */
  init(audioContext) {
    this._ac = audioContext;
    this._piano = null;
    // instruments intentionally not reset — PlaybackEngine captures the
    // reference to this.instruments right after this call.
  }

  /** Called once per unique MIDI program ID found in the score */
  async load(midiId) {
    if (!this._piano) {
      this._piano = await Soundfont.instrument(
        this._ac,
        'acoustic_grand_piano',
        { soundfont: 'FluidR3_GM' }
      );
    }
    // Mark the pre-populated entry as loaded
    const entry = this.instruments.find((i) => i.midiId === midiId);
    if (entry) entry.loaded = true;
  }

  /**
   * Schedule an array of notes for a future AudioContext time.
   * Notes have the shape { note, gain, duration, articulation } as defined by
   * NotePlaybackInstruction. We map `note` → `midi` explicitly since
   * soundfont-player's schedule reads `o.midi` (among other aliases) and
   * using an explicit numeric property avoids falsy-zero edge cases.
   * @param {number} midiId
   * @param {number} time  AudioContext time in seconds
   * @param {import('osmd-audio-player/dist/players/NotePlaybackOptions').NotePlaybackInstruction[]} notes
   */
  schedule(midiId, time, notes) {
    if (this._mutedIds.has(midiId) || !this._piano) return;
    this._piano.schedule(
      time,
      notes.map((n) => ({ midi: n.note, gain: n.gain, duration: n.duration }))
    );
  }

  /** Play a single note immediately (required by interface) */
  play(midiId, options) {
    if (this._mutedIds.has(midiId) || !this._piano) return;
    this._piano.play(options.note, this._ac.currentTime, {
      gain: options.gain,
      duration: options.duration,
    });
  }

  /** Stop all notes for a MIDI ID */
  stop(_midiId) {
    if (this._piano) this._piano.stop();
  }

  // ── mute API ──────────────────────────────────────────────────────
  setMuted(midiId, muted) {
    if (muted) {
      this._mutedIds.add(midiId);
    } else {
      this._mutedIds.delete(midiId);
    }
  }
}
