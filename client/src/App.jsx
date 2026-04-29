import { useState } from 'react';
import FileList from './components/FileList.jsx';
import SheetPlayer from './components/SheetPlayer.jsx';

export default function App() {
  const [selectedFile, setSelectedFile] = useState(null);

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎵 Sheet Player</h1>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <FileList onSelect={setSelectedFile} selected={selectedFile} />
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
