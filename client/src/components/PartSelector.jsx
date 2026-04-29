import PropTypes from 'prop-types';

export default function PartSelector({ items, onMuteToggle, title = 'Parts' }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="part-selector">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`part-item${item.muted ? ' muted' : ''}`}
              onClick={() => onMuteToggle(item.id, !item.muted)}
            >
              <input type="checkbox" checked={!item.muted} readOnly tabIndex={-1} />
              <span>{item.name || item.id}</span>
              {item.memberCount > 1 && (
                <span className="part-badge">{item.memberCount} parts</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

PartSelector.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string,
      muted: PropTypes.bool,
      memberCount: PropTypes.number,
    }),
  ),
  onMuteToggle: PropTypes.func.isRequired,
  title: PropTypes.string,
};
