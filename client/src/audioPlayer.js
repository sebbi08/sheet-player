/**
 * CustomPianoPlayer  –  implements the InstrumentPlayer interface expected by
 * osmd-audio-player's PlaybackEngine (v0.7.0).
 *
 * Every MIDI program number is routed through a single Acoustic Grand Piano
 * soundfont so the score always sounds like piano regardless of the instrument
 * definitions in the MusicXML file.
 *
 * Per-part muting is handled by tracking which MIDI IDs are silenced.
 */
import Soundfont from 'soundfont-player';

export class CustomPianoPlayer {
  constructor() {
    /** @type {{ midiId: number; name: string; loaded: boolean }[]} */
    this.instruments = [];
    this._piano = null;       // soundfont-player player instance
    this._ac = null;          // AudioContext (provided by PlaybackEngine)
    this._mutedIds = new Set(); // set of muted midiIds
  }

  /** Called by PlaybackEngine constructor */
  init(audioContext) {
    this._ac = audioContext;
    this._piano = null;
    this.instruments = [];
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
    if (!this.instruments.find((i) => i.midiId === midiId)) {
      this.instruments.push({ midiId, name: 'Piano', loaded: true });
    }
  }

  /**
   * Schedule an array of notes for a future AudioContext time.
   * @param {number} midiId
   * @param {number} time  AudioContext time in seconds
   * @param {{ note: number; gain: number; duration: number }[]} notes
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
