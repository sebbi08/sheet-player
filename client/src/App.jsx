import { useState } from 'react';
import FileList from './components/FileList.jsx';
import SheetPlayer from './components/SheetPlayer.jsx';
import AdminPanel from './components/AdminPanel.jsx';

export default function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [filesRefreshToken, setFilesRefreshToken] = useState(0);

  function handleFilesChanged(changes = {}) {
    if (changes.deletedFilename && selectedFile?.filename === changes.deletedFilename) {
      setSelectedFile(null);
    }
    setFilesRefreshToken((prev) => prev + 1);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎵 Sheet Player</h1>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <FileList
            onSelect={setSelectedFile}
            selected={selectedFile}
            refreshToken={filesRefreshToken}
          />
          <AdminPanel onFilesChanged={handleFilesChanged} />
        </aside>
        <main className="main-content">
          {selectedFile ? (
            <SheetPlayer key={selectedFile.filename} fileInfo={selectedFile} />
          ) : (
            <div className="placeholder">
              <div className="placeholder-icon">🎼</div>
              <p>Select a score from the list to begin.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
