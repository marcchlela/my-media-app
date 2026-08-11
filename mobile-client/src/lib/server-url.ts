export const CONNECTION_ERROR = "Can't reach your MyFlix server. Make sure the server is online and, if you use Tailscale, that Tailscale is connected.";

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter your MyFlix server URL.');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a complete HTTP or HTTPS server URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('The server URL must use HTTP or HTTPS.');
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error('Enter a valid server URL without credentials.');
  if (parsed.search || parsed.hash) throw new Error('Remove query parameters and fragments from the server URL.');
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

export function joinServerUrl(serverUrl: string, resource: string): string {
  const path = resource.startsWith('/') ? resource : `/${resource}`;
  return `${normalizeServerUrl(serverUrl)}${path}`;
}
