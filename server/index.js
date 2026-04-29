'use strict';

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 3001;
const MUSIC_DIR = path.join(__dirname, 'music');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

app.use(cors());
app.use(express.json());

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

// Rate-limit the API to prevent abuse when the server is exposed
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // 120 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
});

function sanitizeUploadFilename(originalName) {
  const baseName = path.basename(originalName || 'upload.musicxml');
  const normalized = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(normalized).toLowerCase();
  const hasValidExt = ['.xml', '.musicxml', '.mxl'].includes(ext);
  return hasValidExt ? normalized : `${normalized}.musicxml`;
}

function isAllowedMusicXmlFile(name) {
  return /\.(xml|musicxml|mxl)$/i.test(name || '');
}

function readAdminPassword(req) {
  return req.get('x-admin-password') || req.body?.password || '';
}

function requireAdminPassword(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: 'Admin interface is disabled. Set ADMIN_PASSWORD on the server.',
    });
  }

  const provided = readAdminPassword(req);
  if (provided !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MUSIC_DIR),
    filename: (_req, file, cb) => cb(null, sanitizeUploadFilename(file.originalname)),
  }),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedMusicXmlFile(file.originalname)) {
      return cb(new Error('Only .xml, .musicxml or .mxl files are allowed'));
    }
    cb(null, true);
  },
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
  } catch (err) {
    console.error('Error parsing MusicXML metadata:', filePath, err);
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

app.post('/api/admin/verify', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: 'Admin interface is disabled. Set ADMIN_PASSWORD on the server.',
    });
  }

  const provided = readAdminPassword(req);
  if (provided !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }

  return res.json({ ok: true });
});

app.post('/api/admin/upload', requireAdminPassword, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 10 MB)' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    return res.status(201).json({
      ok: true,
      filename: req.file.filename,
      size: req.file.size,
    });
  });
});

app.delete('/api/admin/files/:filename', requireAdminPassword, (req, res) => {
  const safe = path.basename(req.params.filename || '');
  if (!isAllowedMusicXmlFile(safe)) {
    return res.status(400).json({ error: 'Invalid file type' });
  }

  const filePath = path.join(MUSIC_DIR, safe);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    fs.unlinkSync(filePath);
    return res.json({ ok: true, filename: safe });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to delete file' });
  }
});

// Serve the built client in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientBuild));
  app.get('*', apiLimiter, (_req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Sheet-player server  →  http://localhost:${PORT}`);
  console.log(`Music directory      →  ${MUSIC_DIR}`);
  if (!ADMIN_PASSWORD) {
    console.warn('Admin interface is disabled. Set ADMIN_PASSWORD to enable uploads.');
  }
});
