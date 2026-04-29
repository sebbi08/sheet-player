export default function PartSelector({ instruments, onMuteToggle }) {
  if (!instruments || instruments.length === 0) return null;
  return (
    <div className="part-selector">
      <h3>Parts</h3>
      <ul>
        {instruments.map((inst) => (
          <li
            key={inst.id}
            className={`part-item${inst.muted ? ' muted' : ''}`}
            onClick={() => onMuteToggle(inst.id, !inst.muted)}
          >
            <input type="checkbox" checked={!inst.muted} readOnly tabIndex={-1} />
            <span>{inst.name || inst.id}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
