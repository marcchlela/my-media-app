const fs = require('fs');
const path = require('path');

function cleanEnvValue(value) {
  if (value === undefined || value === null) return '';
  let cleaned = String(value).trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.trim();
}

function parseEnvText(text) {
  const map = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (!key) continue;

    map.set(key, cleanEnvValue(value));
  }
  return map;
}

function readEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return new Map();
    const text = fs.readFileSync(filePath, 'utf-8');
    return parseEnvText(text);
  } catch (err) {
    return new Map();
  }
}

function resolveTmdbApiKey() {
  const fromProcess = cleanEnvValue(process.env.TMDB_API_KEY);
  if (fromProcess) return fromProcess;

  for (const envMap of loadEnvMaps()) {
    const key = cleanEnvValue(envMap.get('TMDB_API_KEY'));
    if (key) return key;
  }

  return '';
}

function loadEnvMaps() {
  const rootCandidates = [
    __dirname,
    process.cwd(),
    process.resourcesPath,
    path.dirname(process.execPath || ''),
  ].filter(Boolean);

  const candidates = [];
  for (const root of rootCandidates) {
    candidates.push(path.join(root, '.env'));
    candidates.push(path.join(root, '.env.local'));
  }

  return candidates.map((candidate) => readEnvFile(candidate));
}

function resolveAdminEmails() {
  const fromProcess = cleanEnvValue(process.env.ADMIN_EMAILS);
  const values = [];
  if (fromProcess) values.push(fromProcess);

  for (const envMap of loadEnvMaps()) {
    const value = cleanEnvValue(envMap.get('ADMIN_EMAILS'));
    if (value) values.push(value);
  }

  return Array.from(new Set(
    values
      .flatMap((value) => String(value).split(','))
      .map((entry) => cleanEnvValue(entry).toLowerCase())
      .filter(Boolean)
  ));
}

function normalizeUrl(value) {
  const cleaned = cleanEnvValue(value);
  if (!cleaned) return '';
  try {
    const url = new URL(cleaned);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch (err) {
    return '';
  }
}

function resolveSharedServerUrl() {
  const fromProcess = normalizeUrl(process.env.SHARED_SERVER_URL);
  if (fromProcess) return fromProcess;

  for (const envMap of loadEnvMaps()) {
    const value = normalizeUrl(envMap.get('SHARED_SERVER_URL'));
    if (value) return value;
  }

  return '';
}

module.exports = {
  resolveAdminEmails,
  resolveSharedServerUrl,
  resolveTmdbApiKey,
};
