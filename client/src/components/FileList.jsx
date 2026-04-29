import { useEffect, useState } from 'react';

export default function FileList({ onSelect, selected, reloadKey = 0, onFilesLoaded }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/files')
      .then((r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setFiles(data);
        onFilesLoaded?.(data);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [reloadKey, onFilesLoaded]);

  if (loading) return <div className="file-list-msg">Loading…</div>;
  if (error)   return <div className="file-list-msg error">⚠ {error}</div>;
  if (files.length === 0)
    return (
      <div className="file-list-msg">
        No MusicXML files found in <code>server/music/</code>.
      </div>
    );

  return (
    <div className="file-list">
      <h2>Scores</h2>
      <ul>
        {files.map((file) => (
          <li
            key={file.filename}
            className={`file-item${selected?.filename === file.filename ? ' selected' : ''}`}
            onClick={() => onSelect(file)}
          >
            <div className="file-title">{file.title}</div>
            {file.composer && <div className="file-composer">{file.composer}</div>}
            <div className="file-meta">{file.partCount} part{file.partCount !== 1 ? 's' : ''}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
