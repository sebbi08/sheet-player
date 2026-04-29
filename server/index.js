'use strict';

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const { XMLParser } = require('fast-xml-parser');
const {
  pruneGroupsAgainstPartIds,
  validateAndNormalizeGroups,
} = require('./lib/groupUtils');

const app = express();
const PORT = process.env.PORT || 3001;
const MUSIC_DIR = path.join(__dirname, 'music');
const DATA_DIR = path.join(__dirname, 'data');
const GROUPS_FILE = path.join(MUSIC_DIR, 'groups.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'admin-sessions.json');
const ADMIN_LOG_FILE = path.join(DATA_DIR, 'admin-actions.log.jsonl');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE_NAME = 'sheet_player_admin';
const NON_REMEMBER_SESSION_MS = 8 * 60 * 60 * 1000;
const REMEMBER_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_EXTENSIONS = new Set(['.xml', '.mxl', '.musicxml']);
const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024;

app.use(cors());
app.use(express.json());

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, ALLOWED_EXTENSIONS.has(ext));
  },
});

function safeBasename(name) {
  return path.basename((name || '').trim());
}

function isAllowedMusicFile(name) {
  return ALLOWED_EXTENSIONS.has(path.extname(name || '').toLowerCase());
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read JSON file:', filePath, err);
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function loadGroupsMap() {
  const parsed = readJsonFile(GROUPS_FILE, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed;
}

function saveGroupsMap(groupsMap) {
  writeJsonFile(GROUPS_FILE, groupsMap);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  const parts = header.split(';');
  for (const item of parts) {
    const [k, ...rest] = item.trim().split('=');
    if (!k) continue;
    result[k] = decodeURIComponent(rest.join('='));
  }
  return result;
}

function buildSetCookie(name, value, maxAgeSec = null) {
  const base = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec !== null) base.push(`Max-Age=${maxAgeSec}`);
  return base.join('; ');
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', buildSetCookie(COOKIE_NAME, '', 0));
}

function loadSessionsStore() {
  const parsed = readJsonFile(SESSIONS_FILE, { sessions: {} });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { sessions: {} };
  }
  if (!parsed.sessions || typeof parsed.sessions !== 'object') {
    return { sessions: {} };
  }
  return parsed;
}

const sessionStore = loadSessionsStore();

function persistSessionsStore() {
  writeJsonFile(SESSIONS_FILE, sessionStore);
}

function pruneExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [sessionId, session] of Object.entries(sessionStore.sessions)) {
    if (!session || typeof session !== 'object' || now >= Number(session.expiresAt || 0)) {
      delete sessionStore.sessions[sessionId];
      changed = true;
    }
  }
  if (changed) persistSessionsStore();
}

function logAdminAction(req, action, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    ip: req.ip,
    action,
    ...details,
  };
  try {
    fs.appendFileSync(ADMIN_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch (err) {
    console.error('Failed to write admin log entry:', err);
  }
}

function getPartIdsForFilename(filename) {
  const filePath = path.join(MUSIC_DIR, filename);
  if (!fs.existsSync(filePath)) return [];
  const meta = parseMusicXmlMetadata(filePath);
  return (meta.parts || []).map((p) => p.id).filter(Boolean);
}

function createSession(rememberMe) {
  const now = Date.now();
  const sessionId = crypto.randomBytes(12).toString('hex');
  const rawToken = crypto.randomBytes(32).toString('hex');
  const ttlMs = rememberMe ? REMEMBER_SESSION_MS : NON_REMEMBER_SESSION_MS;
  sessionStore.sessions[sessionId] = {
    tokenHash: sha256(rawToken),
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ttlMs,
    rememberMe: Boolean(rememberMe),
  };
  persistSessionsStore();
  return {
    cookieValue: `${sessionId}.${rawToken}`,
    maxAgeSec: Math.floor(ttlMs / 1000),
    sessionId,
  };
}

function parseSessionFromRequest(req) {
  pruneExpiredSessions();
  const cookies = parseCookies(req.headers.cookie || '');
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const [sessionId, token] = raw.split('.');
  if (!sessionId || !token) return null;

  const entry = sessionStore.sessions[sessionId];
  if (!entry) return null;
  if (Date.now() >= Number(entry.expiresAt || 0)) {
    delete sessionStore.sessions[sessionId];
    persistSessionsStore();
    return null;
  }
  if (sha256(token) !== entry.tokenHash) return null;
  return { sessionId, entry };
}

function requireAdmin(req, res, next) {
  const session = parseSessionFromRequest(req);
  if (!session) {
    clearAdminCookie(res);
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  req.adminSessionId = session.sessionId;
  next();
}

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
    const creators = Array.isArray(rawCreators) ? rawCreators : [];
    if (!Array.isArray(rawCreators) && rawCreators) {
      creators.push(rawCreators);
    }

    const composerEntry = creators.find((c) => c['@_type'] === 'composer');
    const composer =
      typeof composerEntry === 'object'
        ? composerEntry['#text'] || ''
        : composerEntry || '';

    // part list
    const partList = root['part-list'] || {};
    const rawParts = partList['score-part'];
    const parts = Array.isArray(rawParts) ? rawParts : [];
    if (!Array.isArray(rawParts) && rawParts) {
      parts.push(rawParts);
    }

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
      .filter((f) => isAllowedMusicFile(f))
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
  const safe = safeBasename(req.params.filename);
  const filePath = path.join(MUSIC_DIR, safe);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.sendFile(filePath);
});

app.get('/api/groups/:filename', (req, res) => {
  const filename = safeBasename(req.params.filename);
  const groups = loadGroupsMap();
  res.json({ filename, groups: groups[filename] || [] });
});

app.get('/api/admin/session', (req, res) => {
  const session = parseSessionFromRequest(req);
  if (!session) {
    clearAdminCookie(res);
    return res.json({ authenticated: false });
  }
  return res.json({ authenticated: true });
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD is not configured on the server' });
  }
  const providedPassword = String(req.body?.password || '');
  const rememberMe = Boolean(req.body?.rememberMe);
  if (!providedPassword) {
    return res.status(400).json({ error: 'Password is required' });
  }
  if (providedPassword !== ADMIN_PASSWORD) {
    logAdminAction(req, 'admin.login.failed');
    return res.status(401).json({ error: 'Invalid admin password' });
  }

  const created = createSession(rememberMe);
  res.setHeader('Set-Cookie', buildSetCookie(COOKIE_NAME, created.cookieValue, created.maxAgeSec));
  logAdminAction(req, 'admin.login.success', {
    rememberMe,
    sessionId: created.sessionId,
  });
  return res.json({ authenticated: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  if (req.adminSessionId) {
    delete sessionStore.sessions[req.adminSessionId];
    persistSessionsStore();
  }
  clearAdminCookie(res);
  logAdminAction(req, 'admin.logout', { sessionId: req.adminSessionId || null });
  return res.json({ ok: true });
});

app.post('/api/admin/files', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or unsupported file extension' });
  }

  const filename = safeBasename(req.file.originalname);
  if (!filename || !isAllowedMusicFile(filename)) {
    return res.status(400).json({ error: 'Only .xml, .musicxml and .mxl files are allowed' });
  }

  const targetPath = path.join(MUSIC_DIR, filename);
  if (fs.existsSync(targetPath)) {
    return res.status(409).json({ error: 'File already exists. Use replace instead.' });
  }

  fs.writeFileSync(targetPath, req.file.buffer);
  const stats = fs.statSync(targetPath);
  const meta = parseMusicXmlMetadata(targetPath);

  logAdminAction(req, 'sheet.upload', {
    filename,
    size: req.file.size,
    sessionId: req.adminSessionId,
  });
  return res.status(201).json({
    filename,
    size: stats.size,
    modified: stats.mtime,
    ...meta,
  });
});

app.put('/api/admin/files/:filename', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or unsupported file extension' });
  }

  const filename = safeBasename(req.params.filename);
  if (!filename || !isAllowedMusicFile(filename)) {
    return res.status(400).json({ error: 'Invalid target filename' });
  }

  const targetPath = path.join(MUSIC_DIR, filename);
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'Target file not found' });
  }

  fs.writeFileSync(targetPath, req.file.buffer);
  const stats = fs.statSync(targetPath);
  const meta = parseMusicXmlMetadata(targetPath);

  const groupsMap = loadGroupsMap();
  const pruned = pruneGroupsAgainstPartIds(groupsMap[filename] || [], getPartIdsForFilename(filename));
  if (pruned.length > 0) {
    groupsMap[filename] = pruned;
  } else {
    delete groupsMap[filename];
  }
  saveGroupsMap(groupsMap);

  logAdminAction(req, 'sheet.replace', {
    filename,
    size: req.file.size,
    sessionId: req.adminSessionId,
  });
  return res.json({
    filename,
    size: stats.size,
    modified: stats.mtime,
    groups: groupsMap[filename] || [],
    ...meta,
  });
});

app.delete('/api/admin/files/:filename', requireAdmin, (req, res) => {
  const filename = safeBasename(req.params.filename);
  if (!filename || !isAllowedMusicFile(filename)) {
    return res.status(400).json({ error: 'Invalid target filename' });
  }

  const targetPath = path.join(MUSIC_DIR, filename);
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'Target file not found' });
  }

  fs.unlinkSync(targetPath);
  const groupsMap = loadGroupsMap();
  delete groupsMap[filename];
  saveGroupsMap(groupsMap);

  logAdminAction(req, 'sheet.delete', {
    filename,
    sessionId: req.adminSessionId,
  });
  return res.json({ ok: true });
});

app.put('/api/admin/groups/:filename', requireAdmin, (req, res) => {
  const filename = safeBasename(req.params.filename);
  if (!filename || !isAllowedMusicFile(filename)) {
    return res.status(400).json({ error: 'Invalid target filename' });
  }

  const targetPath = path.join(MUSIC_DIR, filename);
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'Target file not found' });
  }

  const groups = Array.isArray(req.body?.groups) ? req.body.groups : null;
  if (!groups) {
    return res.status(400).json({ error: 'Body must include a groups array' });
  }

  const validPartIds = getPartIdsForFilename(filename);
  const validation = validateAndNormalizeGroups(groups, validPartIds);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const groupsMap = loadGroupsMap();
  if (validation.groups.length > 0) {
    groupsMap[filename] = validation.groups;
  } else {
    delete groupsMap[filename];
  }
  saveGroupsMap(groupsMap);

  logAdminAction(req, 'groups.update', {
    filename,
    count: validation.groups.length,
    sessionId: req.adminSessionId,
  });
  return res.json({ filename, groups: groupsMap[filename] || [] });
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Uploaded file is too large. Max size is 10 MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(500).json({ error: 'Unexpected server error' });
  }
  return next();
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
  pruneExpiredSessions();
  console.log(`Sheet-player server  →  http://localhost:${PORT}`);
  console.log(`Music directory      →  ${MUSIC_DIR}`);
});
