export default function PlayerControls({ playing, ready, tempo, onPlay, onPause, onStop, onTempoChange }) {
  return (
    <div className="player-controls">
      <h3>Playback</h3>
      <div className="btn-row">
        {!playing ? (
          <button className="btn btn-play" onClick={onPlay} disabled={!ready} title="Play">▶ Play</button>
        ) : (
          <button className="btn btn-pause" onClick={onPause} disabled={!ready} title="Pause">⏸ Pause</button>
        )}
        <button className="btn btn-stop" onClick={onStop} disabled={!ready} title="Stop">■ Stop</button>
      </div>
      <div className="tempo-row">
        <label>
          <span>Tempo</span>
          <span>{Math.round(tempo * 100)}%</span>
        </label>
        <input
          type="range"
          min={0.25}
          max={2.0}
          step={0.05}
          value={tempo}
          disabled={!ready}
          onChange={(e) => onTempoChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
