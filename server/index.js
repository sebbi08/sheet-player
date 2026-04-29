'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 3001;
const MUSIC_DIR = path.join(__dirname, 'music');

app.use(cors());
app.use(express.json());

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
});

function parseMusicXmlMetadata(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parser.parse(content);

    const root =
      parsed['score-partwise'] ||
      parsed['score-timewise'] ||
      {};

    const work = root['work'] || {};
    const identification = root['identification'] || {};

    // creator may be a single object or array
    const rawCreators = identification['creator'];
    const creators = Array.isArray(rawCreators)
      ? rawCreators
      : rawCreators
      ? [rawCreators]
      : [];

    const composerEntry = creators.find((c) => c['@_type'] === 'composer');
    const composer =
      typeof composerEntry === 'object'
        ? composerEntry['#text'] || ''
        : composerEntry || '';

    // part list
    const partList = root['part-list'] || {};
    const rawParts = partList['score-part'];
    const parts = Array.isArray(rawParts)
      ? rawParts
      : rawParts
      ? [rawParts]
      : [];

    return {
      title:
        work['work-title'] ||
        path.basename(filePath, path.extname(filePath)),
      composer,
      partCount: parts.length,
      parts: parts.map((p) => ({
        id: p['@_id'] || '',
        name:
          (typeof p['part-name'] === 'object'
            ? p['part-name']['#text']
            : p['part-name']) ||
          p['@_id'] ||
          '',
      })),
    };
  } catch {
    return {
      title: path.basename(filePath, path.extname(filePath)),
      composer: '',
      partCount: 0,
      parts: [],
    };
  }
}

app.get('/api/files', (_req, res) => {
  try {
    const files = fs
      .readdirSync(MUSIC_DIR)
      .filter((f) => /\.(xml|mxl|musicxml)$/i.test(f))
      .map((filename) => {
        const filePath = path.join(MUSIC_DIR, filename);
        const stats = fs.statSync(filePath);
        const meta = parseMusicXmlMetadata(filePath);
        return { filename, size: stats.size, modified: stats.mtime, ...meta };
      });
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/:filename', (req, res) => {
  // Prevent path traversal
  const safe = path.basename(req.params.filename);
  const filePath = path.join(MUSIC_DIR, safe);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.sendFile(filePath);
});

// Serve the built client in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientBuild));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Sheet-player server  →  http://localhost:${PORT}`);
  console.log(`Music directory      →  ${MUSIC_DIR}`);
});
