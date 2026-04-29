import { useState } from 'react';
import FileList from './components/FileList.jsx';
import SheetPlayer from './components/SheetPlayer.jsx';
import AdminPanel from './components/AdminPanel.jsx';

export default function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [view, setView] = useState('player');
  const [libraryVersion, setLibraryVersion] = useState(0);

  function handleFilesLoaded(files) {
    if (!selectedFile) return;
    const next = files.find((f) => f.filename === selectedFile.filename);
    if (!next) {
      setSelectedFile(null);
      return;
    }
    if (
      next.modified !== selectedFile.modified ||
      next.size !== selectedFile.size ||
      next.title !== selectedFile.title ||
      next.composer !== selectedFile.composer
    ) {
      setSelectedFile(next);
    }
  }

  function handleLibraryChanged() {
    setLibraryVersion((v) => v + 1);
  }

  let mainContent = (
    <div className="placeholder">
      <div className="placeholder-icon">🎼</div>
      <p>Select a score from the list to begin.</p>
    </div>
  );

  if (view === 'admin') {
    mainContent = (
      <AdminPanel
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        onLibraryChanged={handleLibraryChanged}
      />
    );
  } else if (selectedFile) {
    mainContent = <SheetPlayer key={selectedFile.filename} fileInfo={selectedFile} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎵 Sheet Player</h1>
        <div className="header-actions">
          <button
            type="button"
            className="admin-toggle-btn"
            onClick={() => setView((prev) => (prev === 'admin' ? 'player' : 'admin'))}
          >
            {view === 'admin' ? 'Back to Player' : 'Admin'}
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <FileList
            onSelect={setSelectedFile}
            selected={selectedFile}
            reloadKey={libraryVersion}
            onFilesLoaded={handleFilesLoaded}
          />
        </aside>
        <main className="main-content">
          {mainContent}
        </main>
      </div>
    </div>
  );
}
