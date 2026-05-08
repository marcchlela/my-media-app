// takes care of the main actions: opening the app, creating window,
// handles file import and more.
// dialogs, OS stuff etc...

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const {
  addFavoriteForUser,
  clearPosterOverrideForUser,
  createUserAccount,
  deleteSessionToken,
  getUserBySessionToken,
  loginUserAccount,
  mergeFavoritesForUser,
  mergePosterOverridesForUser,
  mergeWatchProgressForUser,
  removeFavoriteForUser,
  syncLibraryProgressForUser,
  touchSessionToken,
  upsertPosterOverrideForUser,
  upsertWatchProgress,
} = require('./account-store');
const { resolveSharedServerUrl, resolveTmdbApiKey } = require('./env-config');

let mainWindow;
const libraryPath = () => path.join(app.getPath('userData'), 'library.json');
const accountSessionPath = () => path.join(app.getPath('userData'), 'account-session.json');
const sharedAccountSessionPath = () => path.join(app.getPath('userData'), 'shared-account-session.json');
const SHARED_SERVER_URL = resolveSharedServerUrl();

function readStoredAccountSessionToken() {
  try {
    const filePath = accountSessionPath();
    if (!fs.existsSync(filePath)) return '';
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return typeof parsed?.token === 'string' ? parsed.token : '';
  } catch (err) {
    return '';
  }
}

function writeStoredAccountSessionToken(token) {
  const filePath = accountSessionPath();
  fs.writeFileSync(filePath, JSON.stringify({ token }, null, 2));
}

function clearStoredAccountSessionToken() {
  try {
    const filePath = accountSessionPath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    // Ignore cleanup errors.
  }
}

function hasSharedServer() {
  return !!SHARED_SERVER_URL;
}

function readStoredSharedAccountSessionToken() {
  try {
    const filePath = sharedAccountSessionPath();
    if (!fs.existsSync(filePath)) return '';
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return typeof parsed?.token === 'string' ? parsed.token : '';
  } catch (err) {
    return '';
  }
}

function writeStoredSharedAccountSessionToken(token) {
  const filePath = sharedAccountSessionPath();
  fs.writeFileSync(filePath, JSON.stringify({ token }, null, 2));
}

function clearStoredSharedAccountSessionToken() {
  try {
    const filePath = sharedAccountSessionPath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    // Ignore cleanup errors.
  }
}

function getCurrentAccountSession() {
  const token = readStoredAccountSessionToken();
  if (!token) return { token: '', user: null };

  const user = getUserBySessionToken(token);
  if (!user) {
    clearStoredAccountSessionToken();
    return { token: '', user: null };
  }

  touchSessionToken(token);
  return { token, user };
}

async function requestSharedServerJson(endpointPath, { method = 'GET', body = null, token = '' } = {}) {
  const url = new URL(endpointPath, `${SHARED_SERVER_URL}/`);
  const headers = {
    Accept: 'application/json',
  };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-Session-Token'] = token;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }

  return { response, payload };
}

async function getCurrentSharedAccountSession() {
  const token = readStoredSharedAccountSessionToken();
  if (!token || !hasSharedServer()) return { token: '', user: null };

  try {
    const { response, payload } = await requestSharedServerJson('/api/account/me', { token });
    if (!response.ok || !payload?.authenticated || !payload?.user) {
      clearStoredSharedAccountSessionToken();
      return { token: '', user: null };
    }
    return { token, user: payload.user };
  } catch (err) {
    return { token, user: null, error: err.message || 'Shared server unavailable.' };
  }
}

function absolutizeSharedLibraryItem(item) {
  if (!item || typeof item !== 'object') return item;
  const streamUrl = item.streamUrl ? new URL(item.streamUrl, `${SHARED_SERVER_URL}/`).toString() : null;
  const subtitles = Array.isArray(item.subtitles)
    ? item.subtitles.map((subtitle) => ({
        ...subtitle,
        src: subtitle?.src ? new URL(subtitle.src, `${SHARED_SERVER_URL}/`).toString() : subtitle?.src || null,
      }))
    : [];
  return {
    ...item,
    streamUrl,
    subtitles,
  };
}

function mergeRemoteLibraryProgressIntoItems(items, remoteLibrary) {
  const input = Array.isArray(items) ? items : [];
  const remote = Array.isArray(remoteLibrary) ? remoteLibrary : [];
  const progressByPath = new Map();
  for (const item of remote) {
    if (item?.path && item?.watchProgress) {
      progressByPath.set(item.path, item.watchProgress);
    }
  }

  return input.map((item) => {
    const remoteMatch = item?.path ? remote.find((remoteItem) => remoteItem?.path === item.path) : null;
    const watchProgress = item?.path ? progressByPath.get(item.path) : null;
    if (!watchProgress && !remoteMatch?.customPosterPath && !remoteMatch?.customPosterTmdbPath && !remoteMatch?.isFavorite) return item;
    return {
      ...item,
      ...(watchProgress ? { watchProgress } : {}),
      ...(remoteMatch?.customPosterPath ? { customPosterPath: remoteMatch.customPosterPath } : {}),
      ...(remoteMatch?.customPosterTmdbPath ? { customPosterTmdbPath: remoteMatch.customPosterTmdbPath } : {}),
      ...(remoteMatch?.isFavorite ? { isFavorite: true } : {}),
    };
  });
}

function stripPerUserLibraryFields(items) {
  const input = Array.isArray(items) ? items : [];
  return input.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const next = { ...item };
    delete next.customPosterPath;
    delete next.customPosterTmdbPath;
    delete next.isFavorite;
    return next;
  });
}

async function fetchSharedLibrary(token = '') {
  if (!hasSharedServer()) return [];
  const { response, payload } = await requestSharedServerJson('/library', { token });
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(payload?.error || `Shared library request failed (${response.status}).`);
  }
  return payload.map(absolutizeSharedLibraryItem);
}

async function getEffectiveAccountSession() {
  if (hasSharedServer()) {
    return getCurrentSharedAccountSession();
  }
  return getCurrentAccountSession();
}

async function isCurrentUserAdmin() {
  const session = await getEffectiveAccountSession();
  return !!session.user?.isAdmin;
}

function adminDenied(defaultValue, error = 'Admin access required.') {
  if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
    return { ...defaultValue, ok: false, error, adminRequired: true };
  }
  return defaultValue;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // make sure this path is correct
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.loadFile('index.html');
}

// folder/file dialog helpers
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.mpg', '.mpeg', '.vob']);
const SUBTITLE_EXTS = new Set(['.srt', '.vtt']);
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = resolveTmdbApiKey();

function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

async function tmdbGet(endpoint, query = {}) {
  if (!TMDB_API_KEY) {
    throw new Error('TMDB API key is not configured. Set TMDB_API_KEY in environment or .env before launching the app.');
  }

  const url = new URL(`${TMDB_API_BASE}${endpoint}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString());
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.status_message || `TMDB request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function collectVideoFiles(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectVideoFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (VIDEO_EXTS.has(ext)) {
      results.push({ path: fullPath, name: entry.name });
    }
  }

  return results;
}

async function collectMediaFromPath(targetPath) {
  try {
    const stat = await fs.promises.stat(targetPath);
    if (stat.isDirectory()) {
      return collectVideoFiles(targetPath);
    }
    if (stat.isFile()) {
      const ext = path.extname(targetPath).toLowerCase();
      if (VIDEO_EXTS.has(ext)) {
        return [{ path: targetPath, name: path.basename(targetPath) }];
      }
    }
  } catch (err) {
    console.error('Failed to read path:', targetPath, err);
  }
  return [];
}

async function handleSelectMedia() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos', extensions: Array.from(VIDEO_EXTS).map((ext) => ext.slice(1)) }],
  });
  if (result.canceled) return [];

  return result.filePaths.map((filePath) => ({
    path: filePath,
    name: path.basename(filePath),
  }));
}

async function handleSelectSubtitles() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Subtitles', extensions: Array.from(SUBTITLE_EXTS).map((ext) => ext.slice(1)) }],
  });
  if (result.canceled) return [];

  const prepared = [];
  for (const filePath of result.filePaths) {
    const subtitle = prepareSubtitleFile(filePath);
    if (subtitle) prepared.push(subtitle);
  }
  return prepared;
}

async function handleSelectPoster() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  if (result.canceled || !result.filePaths?.length) return null;

  const filePath = result.filePaths[0];
  return {
    path: filePath,
    name: path.basename(filePath),
  };
}

function subtitleCacheDir() {
  return path.join(app.getPath('userData'), 'subtitle-cache');
}

function srtToVttContent(content) {
  const normalized = content.replace(/\r/g, '');
  const convertedTiming = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2'
  );
  return `WEBVTT\n\n${convertedTiming}`;
}

function extractSubtitleAnalysis(filePath, originalContent) {
  const fileName = path.basename(filePath);
  const baseName = fileName.replace(/\.[^/.]+$/, '');
  const noSeparators = baseName.replace(/[\._-]+/g, ' ');
  const episodeMatch = noSeparators.match(/S(\d{1,2})E(\d{1,2})/i);

  const lines = String(originalContent || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const meaningful = [];
  for (const line of lines) {
    if (/^\d+$/.test(line)) continue;
    if (/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}$/.test(line)) continue;
    meaningful.push(line);
    if (meaningful.length >= 18) break;
  }

  const headerText = meaningful.join(' ').slice(0, 900);
  const tokenSource = `${noSeparators} ${headerText}`.toLowerCase();
  const tokens = Array.from(
    new Set(
      tokenSource
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !/^\d+$/.test(token))
    )
  ).slice(0, 120);

  return {
    baseName: noSeparators.toLowerCase(),
    headerText: headerText.toLowerCase(),
    tokens,
    episode: episodeMatch
      ? { season: Number.parseInt(episodeMatch[1], 10), episode: Number.parseInt(episodeMatch[2], 10) }
      : null,
  };
}

function prepareSubtitleFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUBTITLE_EXTS.has(ext)) return null;

    const sourceContent = fs.readFileSync(filePath, 'utf-8');
    let trackPath = filePath;
    if (ext === '.srt') {
      const vttContent = srtToVttContent(sourceContent);
      const baseName = path.basename(filePath, ext);
      const targetFile = `${baseName}-${Date.now()}.vtt`;
      const targetPath = path.join(subtitleCacheDir(), targetFile);
      fs.mkdirSync(subtitleCacheDir(), { recursive: true });
      fs.writeFileSync(targetPath, vttContent, 'utf-8');
      trackPath = targetPath;
    }

    const analysis = extractSubtitleAnalysis(filePath, sourceContent);

    return {
      path: filePath,
      name: path.basename(filePath),
      trackPath,
      trackUrl: pathToFileURL(trackPath).toString(),
      analysis,
    };
  } catch (err) {
    console.error('Failed to prepare subtitle file:', filePath, err);
    return null;
  }
}

async function scanMissingLibraryItems(items) {
  const missing = [];
  if (!Array.isArray(items)) return missing;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item?.path) continue;

    let exists = false;
    try {
      const stat = await fs.promises.stat(item.path);
      exists = stat.isFile();
    } catch (err) {
      exists = false;
    }

    if (!exists) {
      missing.push({
        index,
        path: item.path,
        name: item.name,
        isShow: !!item.isShow,
        showName: item.showName || null,
      });
    }
  }

  return missing;
}

async function collectVideoCandidates(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectVideoCandidates(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (VIDEO_EXTS.has(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

function getCdDrivePaths() {
  if (process.platform !== 'win32') return [];

  try {
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 5 } | Select-Object -ExpandProperty DeviceID",
      ],
      { encoding: 'utf-8', windowsHide: true }
    );

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((drive) => `${drive}\\`);
  } catch (err) {
    console.error('Failed to detect CD drives:', err);
    return [];
  }
}

async function handleSelectMediaFromCd() {
  const drivePaths = getCdDrivePaths();
  if (!drivePaths.length) return [];

  const files = [];
  for (const drivePath of drivePaths) {
    files.push(...await collectMediaFromPath(drivePath));
  }

  return files;
}

ipcMain.handle('select-media', async () => {
  if (!await isCurrentUserAdmin()) return [];
  return handleSelectMedia();
});
ipcMain.handle('select-folder', async () => {
  if (!await isCurrentUserAdmin()) return [];
  return handleSelectMedia();
});
ipcMain.handle('select-media-from-cd', async () => {
  if (!await isCurrentUserAdmin()) return [];
  return handleSelectMediaFromCd();
});
ipcMain.handle('select-subtitles', async () => {
  if (!await isCurrentUserAdmin()) return [];
  return handleSelectSubtitles();
});
ipcMain.handle('select-poster', async () => {
  if (!await isCurrentUserAdmin()) return null;
  return handleSelectPoster();
});
ipcMain.handle('tmdb:movie:search', async (_event, query) => {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    return await tmdbGet('/search/movie', { query: q });
  } catch (err) {
    console.error('TMDB movie search failed:', err.message);
    return null;
  }
});
ipcMain.handle('tmdb:tv:search', async (_event, query) => {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    return await tmdbGet('/search/tv', { query: q });
  } catch (err) {
    console.error('TMDB TV search failed:', err.message);
    return null;
  }
});
ipcMain.handle('tmdb:movie:details', async (_event, movieId) => {
  const id = toPositiveInt(movieId);
  if (!id) return null;
  try {
    return await tmdbGet(`/movie/${id}`);
  } catch (err) {
    console.error('TMDB movie details failed:', err.message);
    return null;
  }
});
ipcMain.handle('tmdb:movie:images', async (_event, movieId) => {
  const id = toPositiveInt(movieId);
  if (!id) return null;
  try {
    return await tmdbGet(`/movie/${id}/images`);
  } catch (err) {
    console.error('TMDB movie images failed:', err.message);
    return null;
  }
});
ipcMain.handle('tmdb:movie:credits', async (_event, movieId) => {
  const id = toPositiveInt(movieId);
  if (!id) return null;
  try {
    return await tmdbGet(`/movie/${id}/credits`);
  } catch (err) {
    console.error('TMDB movie credits failed:', err.message);
    return null;
  }
});
ipcMain.handle('tmdb:movie:videos', async (_event, movieId) => {
  const id = toPositiveInt(movieId);
  if (!id) return null;
  try {
    return await tmdbGet(`/movie/${id}/videos`);
  } catch (err) {
    console.error('TMDB movie videos failed:', err.message);
    return null;
  }
});
ipcMain.handle('open-trailer-window', async (_event, payload) => {
  const urlValue = String(payload?.url || '').trim();
  const titleValue = String(payload?.title || 'Trailer').trim() || 'Trailer';

  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }

  const allowedHosts = new Set([
    'www.youtube.com',
    'youtube.com',
    'm.youtube.com',
    'www.youtube-nocookie.com',
  ]);
  const isAllowedPath = parsed.pathname.startsWith('/embed/') || parsed.pathname === '/watch';
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname) || !isAllowedPath) {
    return { ok: false, error: 'invalid_url' };
  }

  const trailerWindow = new BrowserWindow({
    parent: mainWindow || undefined,
    width: 1120,
    height: 720,
    minWidth: 820,
    minHeight: 520,
    title: titleValue,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  trailerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await trailerWindow.loadURL(parsed.toString(), {
    httpReferrer: 'https://www.youtube.com/',
  });
  return { ok: true };
});
ipcMain.handle('tmdb:tv:credits', async (_event, tvId) => {
  const id = toPositiveInt(tvId);
  if (!id) return null;
  try {
    return await tmdbGet(`/tv/${id}/credits`);
  } catch (err) {
    console.error('TMDB TV credits failed:', err.message);
    return null;
  }
});
ipcMain.handle('tmdb:tv:images', async (_event, tvId) => {
  const id = toPositiveInt(tvId);
  if (!id) return null;
  try {
    return await tmdbGet(`/tv/${id}/images`);
  } catch (err) {
    console.error('TMDB TV images failed:', err.message);
    return null;
  }
});
ipcMain.handle('tmdb:tv:episode', async (_event, tvId, seasonNumber, episodeNumber) => {
  const id = toPositiveInt(tvId);
  const season = toPositiveInt(seasonNumber);
  const episode = toPositiveInt(episodeNumber);
  if (!id || !season || !episode) return null;
  try {
    return await tmdbGet(`/tv/${id}/season/${season}/episode/${episode}`);
  } catch (err) {
    console.error('TMDB episode details failed:', err.message);
    return null;
  }
});
ipcMain.handle('prepare-subtitle-file', (_event, subtitlePath) => {
  if (!subtitlePath || typeof subtitlePath !== 'string') return null;
  return prepareSubtitleFile(subtitlePath);
});

ipcMain.handle('app:get-context', async () => {
  const session = await getEffectiveAccountSession();
  return {
    ok: true,
    sharedServerConfigured: hasSharedServer(),
    sharedServerUrl: SHARED_SERVER_URL,
    useSharedLibrary: hasSharedServer() && !session.user?.isAdmin,
  };
});

ipcMain.handle('library:read', async () => {
  if (hasSharedServer()) {
    const session = await getCurrentSharedAccountSession();
    if (!session.user?.isAdmin) {
      try {
        return await fetchSharedLibrary(session.token);
      } catch (err) {
        console.error('Error reading shared library:', err);
        return [];
      }
    }
  }
  try {
    const filePath = libraryPath();
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading library:', err);
    return [];
  }
});

ipcMain.handle('library:write', async (_event, items) => {
  if (hasSharedServer() && !await isCurrentUserAdmin()) {
    return false;
  }
  try {
    const filePath = libraryPath();
    fs.writeFileSync(filePath, JSON.stringify(stripPerUserLibraryFields(items), null, 2));
    return true;
  } catch (err) {
    console.error('Error writing library:', err);
    return false;
  }
});

ipcMain.handle('library:export', async (_event, items) => {
  if (!await isCurrentUserAdmin()) return adminDenied({ canceled: true });
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Library',
      defaultPath: 'library.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    fs.writeFileSync(result.filePath, JSON.stringify(items, null, 2));
    return { canceled: false, filePath: result.filePath };
  } catch (err) {
    console.error('Error exporting library:', err);
    return { canceled: true, error: err.message };
  }
});

ipcMain.handle('library:import', async () => {
  if (!await isCurrentUserAdmin()) return adminDenied({ canceled: true, items: [] });
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Library',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths?.length) {
      return { canceled: true, items: [] };
    }

    const data = fs.readFileSync(result.filePaths[0], 'utf-8');
    const items = JSON.parse(data);
    return { canceled: false, items };
  } catch (err) {
    console.error('Error importing library:', err);
    return { canceled: true, items: [], error: err.message };
  }
});

ipcMain.handle('library:stats', async (_event, items) => {
  let totalBytes = 0;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item?.path) continue;
      try {
        const stat = fs.statSync(item.path);
        if (stat.isFile()) totalBytes += stat.size;
      } catch (err) {
        // ignore missing files
      }
    }
  }
  return { totalBytes };
});

ipcMain.handle('library:scan-missing', async (_event, items) => {
  if (!await isCurrentUserAdmin()) return adminDenied({ missing: [] });
  try {
    const missing = await scanMissingLibraryItems(items);
    return { ok: true, missing };
  } catch (err) {
    console.error('Error scanning missing files:', err);
    return { ok: false, missing: [], error: err.message };
  }
});

ipcMain.handle('library:select-relink-file', async (_event, oldPath) => {
  if (!await isCurrentUserAdmin()) return null;
  try {
    const defaultPath = typeof oldPath === 'string' && oldPath
      ? path.dirname(oldPath)
      : app.getPath('videos');

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Replacement File',
      defaultPath,
      properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: Array.from(VIDEO_EXTS).map((ext) => ext.slice(1)) }],
    });
    if (result.canceled || !result.filePaths?.length) return null;
    return result.filePaths[0];
  } catch (err) {
    console.error('Error selecting relink file:', err);
    return null;
  }
});

ipcMain.handle('library:auto-relink', async (_event, items) => {
  if (!await isCurrentUserAdmin()) return adminDenied({ canceled: true, relinks: [], scanned: 0 });
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Folder To Search For Missing Media',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths?.length) {
      return { ok: true, canceled: true, relinks: [], scanned: 0 };
    }

    const root = result.filePaths[0];
    const missing = await scanMissingLibraryItems(items);
    if (!missing.length) {
      return { ok: true, canceled: false, relinks: [], scanned: 0 };
    }

    const candidates = await collectVideoCandidates(root);
    const byName = new Map();
    for (const candidate of candidates) {
      const key = path.basename(candidate).toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(candidate);
    }

    const relinks = [];
    for (const entry of missing) {
      const key = path.basename(entry.path || '').toLowerCase();
      const matches = byName.get(key) || [];
      if (matches.length) {
        relinks.push({
          index: entry.index,
          oldPath: entry.path,
          newPath: matches[0],
        });
      }
    }

    return { ok: true, canceled: false, relinks, scanned: candidates.length };
  } catch (err) {
    console.error('Error auto-relinking files:', err);
    return { ok: false, canceled: false, relinks: [], scanned: 0, error: err.message };
  }
});

ipcMain.handle('account:get-current-user', async () => {
  const session = await getEffectiveAccountSession();
  return { ok: true, user: session.user || null, sharedServerConfigured: hasSharedServer() };
});

ipcMain.handle('account:signup', async (_event, payload) => {
  if (hasSharedServer()) {
    try {
      const { response, payload: remotePayload } = await requestSharedServerJson('/api/account/signup', {
        method: 'POST',
        body: payload || {},
      });
      if (!response.ok) return remotePayload || { ok: false, error: `HTTP ${response.status}` };
      if (remotePayload?.sessionToken) {
        writeStoredSharedAccountSessionToken(remotePayload.sessionToken);
      }
      return {
        ok: true,
        user: remotePayload?.user || null,
      };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not reach shared server.' };
    }
  }

  const result = createUserAccount(payload || {});
  if (!result.ok) return result;
  writeStoredAccountSessionToken(result.sessionToken);
  return {
    ok: true,
    user: result.user,
  };
});

ipcMain.handle('account:login', async (_event, payload) => {
  if (hasSharedServer()) {
    try {
      const { response, payload: remotePayload } = await requestSharedServerJson('/api/account/login', {
        method: 'POST',
        body: payload || {},
      });
      if (!response.ok) return remotePayload || { ok: false, error: `HTTP ${response.status}` };
      if (remotePayload?.sessionToken) {
        writeStoredSharedAccountSessionToken(remotePayload.sessionToken);
      }
      return {
        ok: true,
        user: remotePayload?.user || null,
      };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not reach shared server.' };
    }
  }

  const result = loginUserAccount(payload || {});
  if (!result.ok) return result;
  writeStoredAccountSessionToken(result.sessionToken);
  return {
    ok: true,
    user: result.user,
  };
});

ipcMain.handle('account:logout', async () => {
  if (hasSharedServer()) {
    const token = readStoredSharedAccountSessionToken();
    if (token) {
      try {
        await requestSharedServerJson('/api/account/logout', {
          method: 'POST',
          token,
        });
      } catch (err) {
        // Clear the local token even if the shared server is unavailable.
      }
    }
    clearStoredSharedAccountSessionToken();
    return { ok: true };
  }

  const session = getCurrentAccountSession();
  if (session.token) {
    deleteSessionToken(session.token);
  }
  clearStoredAccountSessionToken();
  return { ok: true };
});

ipcMain.handle('account:merge-library-progress', async (_event, items) => {
  if (hasSharedServer()) {
    const session = await getCurrentSharedAccountSession();
    if (!session.user) {
      return { ok: true, user: null, items: Array.isArray(items) ? items : [] };
    }
    try {
      const remoteLibrary = await fetchSharedLibrary(session.token);
      return {
        ok: true,
        user: session.user,
        items: session.user.isAdmin
          ? mergeRemoteLibraryProgressIntoItems(items, remoteLibrary)
          : remoteLibrary,
      };
    } catch (err) {
      return { ok: false, user: session.user, items: Array.isArray(items) ? items : [], error: err.message };
    }
  }

  const session = getCurrentAccountSession();
  if (!session.user?.id) {
    return {
      ok: true,
      user: null,
      items: Array.isArray(items) ? items : [],
    };
  }

  return {
    ok: true,
    user: session.user,
    items: mergeFavoritesForUser(
      mergePosterOverridesForUser(
        mergeWatchProgressForUser(items, session.user.id),
        session.user.id
      ),
      session.user.id
    ),
  };
});

ipcMain.handle('account:refresh-library-progress', async (_event, items) => {
  if (hasSharedServer()) {
    const session = await getCurrentSharedAccountSession();
    if (!session.user) {
      return {
        ok: true,
        user: null,
        items: Array.isArray(items) ? items : [],
      };
    }

    try {
      const remoteLibrary = await fetchSharedLibrary(session.token);
      return {
        ok: true,
        user: session.user,
        items: session.user.isAdmin
          ? mergeRemoteLibraryProgressIntoItems(items, remoteLibrary)
          : remoteLibrary,
      };
    } catch (err) {
      return {
        ok: false,
        user: session.user,
        items: Array.isArray(items) ? items : [],
        error: err.message,
      };
    }
  }

  const session = getCurrentAccountSession();
  if (!session.user?.id) {
    return {
      ok: true,
      user: null,
      items: Array.isArray(items) ? items : [],
    };
  }

  const merged = mergeWatchProgressForUser(items, session.user.id);
  return {
    ok: true,
    user: session.user,
    items: mergeFavoritesForUser(
      mergePosterOverridesForUser(merged, session.user.id),
      session.user.id
    ),
  };
});

ipcMain.handle('account:add-favorite', async (_event, payload) => {
  if (hasSharedServer()) {
    const session = await getCurrentSharedAccountSession();
    if (!session.user?.id || !session.token) {
      return { ok: false, authenticated: false };
    }

    try {
      const { response, payload: remotePayload } = await requestSharedServerJson('/api/account/favorite', {
        method: 'POST',
        token: session.token,
        body: payload || {},
      });
      if (!response.ok) {
        return remotePayload || { ok: false, authenticated: true, error: `HTTP ${response.status}` };
      }
      return remotePayload || { ok: true, authenticated: true };
    } catch (err) {
      return { ok: false, authenticated: true, error: err.message || 'Could not reach shared server.' };
    }
  }

  const session = getCurrentAccountSession();
  if (!session.user?.id) {
    return { ok: false, authenticated: false };
  }

  const saved = addFavoriteForUser(session.user.id, payload || {});
  if (!saved) {
    return { ok: false, authenticated: true, error: 'Could not save favorite.' };
  }
  return { ok: true, authenticated: true };
});

ipcMain.handle('account:remove-favorite', async (_event, payload) => {
  if (hasSharedServer()) {
    const session = await getCurrentSharedAccountSession();
    if (!session.user?.id || !session.token) {
      return { ok: false, authenticated: false };
    }

    try {
      const { response, payload: remotePayload } = await requestSharedServerJson('/api/account/favorite', {
        method: 'DELETE',
        token: session.token,
        body: payload || {},
      });
      if (!response.ok) {
        return remotePayload || { ok: false, authenticated: true, error: `HTTP ${response.status}` };
      }
      return remotePayload || { ok: true, authenticated: true };
    } catch (err) {
      return { ok: false, authenticated: true, error: err.message || 'Could not reach shared server.' };
    }
  }

  const session = getCurrentAccountSession();
  if (!session.user?.id) {
    return { ok: false, authenticated: false };
  }

  removeFavoriteForUser(session.user.id, payload || {});
  return { ok: true, authenticated: true };
});

ipcMain.handle('account:save-poster-override', async (_event, payload) => {
  if (hasSharedServer()) {
    const session = await getCurrentSharedAccountSession();
    if (!session.user?.id || !session.token) {
      return { ok: false, authenticated: false };
    }

    try {
      const { response, payload: remotePayload } = await requestSharedServerJson('/api/account/poster', {
        method: 'POST',
        token: session.token,
        body: payload || {},
      });
      if (!response.ok) {
        return remotePayload || { ok: false, authenticated: true, error: `HTTP ${response.status}` };
      }
      return remotePayload || { ok: true, authenticated: true };
    } catch (err) {
      return { ok: false, authenticated: true, error: err.message || 'Could not reach shared server.' };
    }
  }

  const session = getCurrentAccountSession();
  if (!session.user?.id) {
    return { ok: false, authenticated: false };
  }

  const saved = upsertPosterOverrideForUser(session.user.id, payload || {});
  if (!saved) {
    return { ok: false, authenticated: true, error: 'Could not save poster override.' };
  }
  return { ok: true, authenticated: true };
});

ipcMain.handle('account:clear-poster-override', async (_event, payload) => {
  if (hasSharedServer()) {
    const session = await getCurrentSharedAccountSession();
    if (!session.user?.id || !session.token) {
      return { ok: false, authenticated: false };
    }

    try {
      const { response, payload: remotePayload } = await requestSharedServerJson('/api/account/poster', {
        method: 'DELETE',
        token: session.token,
        body: payload || {},
      });
      if (!response.ok) {
        return remotePayload || { ok: false, authenticated: true, error: `HTTP ${response.status}` };
      }
      return remotePayload || { ok: true, authenticated: true };
    } catch (err) {
      return { ok: false, authenticated: true, error: err.message || 'Could not reach shared server.' };
    }
  }

  const session = getCurrentAccountSession();
  if (!session.user?.id) {
    return { ok: false, authenticated: false };
  }

  clearPosterOverrideForUser(session.user.id, payload || {});
  return { ok: true, authenticated: true };
});

ipcMain.handle('account:save-watch-progress', async (_event, payload) => {
  if (hasSharedServer()) {
    const session = await getCurrentSharedAccountSession();
    if (!session.user?.id || !session.token) {
      return { ok: false, authenticated: false };
    }

    try {
      const { response, payload: remotePayload } = await requestSharedServerJson('/api/account/progress', {
        method: 'POST',
        token: session.token,
        body: payload || {},
      });
      if (!response.ok) {
        return remotePayload || { ok: false, authenticated: true, error: `HTTP ${response.status}` };
      }
      return remotePayload || { ok: true, authenticated: true };
    } catch (err) {
      return { ok: false, authenticated: true, error: err.message || 'Could not reach shared server.' };
    }
  }

  const session = getCurrentAccountSession();
  if (!session.user?.id) {
    return { ok: false, authenticated: false };
  }

  const watchProgress = upsertWatchProgress(session.user.id, payload || {});
  if (!watchProgress) {
    return { ok: false, authenticated: true, error: 'Invalid progress payload.' };
  }

  return {
    ok: true,
    authenticated: true,
    watchProgress,
  };
});

ipcMain.handle('account:sync-library-progress', async (_event, items) => {
  if (hasSharedServer()) {
    const session = await getCurrentSharedAccountSession();
    if (!session.user?.id || !session.token) {
      return { ok: false, authenticated: false, synced: 0 };
    }

    let synced = 0;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item?.path || !item?.watchProgress) continue;
        try {
          const { response } = await requestSharedServerJson('/api/account/progress', {
            method: 'POST',
            token: session.token,
            body: {
              mediaPath: item.path,
              mediaName: item.name || item.data?.title || item.data?.name || '',
              isShow: !!item.isShow,
              ...item.watchProgress,
            },
          });
          if (response.ok) synced += 1;
        } catch (err) {
          // Keep trying remaining entries.
        }
      }
    }

    return {
      ok: true,
      authenticated: true,
      synced,
    };
  }

  const session = getCurrentAccountSession();
  if (!session.user?.id) {
    return { ok: false, authenticated: false, synced: 0 };
  }

  const synced = syncLibraryProgressForUser(session.user.id, items);
  return {
    ok: true,
    authenticated: true,
    synced,
  };
});

app.whenReady().then(createWindow);
