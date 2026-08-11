export type SubtitleCue = { start: number; end: number; text: string };

function timestampSeconds(value: string) {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  return Number.NaN;
}

function plainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

export function parseWebVtt(source: string): SubtitleCue[] {
  return String(source || '').replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trimEnd());
    const firstLine = lines[0] || '';
    if (!lines.length || /^WEBVTT(?:\s|$)/i.test(firstLine) || /^NOTE(?:\s|$)/i.test(firstLine)) return [];
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) return [];
    const [rawStart = '', rawEnd = ''] = (lines[timingIndex] || '').split('-->');
    const start = timestampSeconds(rawStart || '');
    const end = timestampSeconds(String(rawEnd || '').trim().split(/\s+/)[0] || '');
    const text = plainText(lines.slice(timingIndex + 1).join('\n'));
    return Number.isFinite(start) && Number.isFinite(end) && end > start && text ? [{ start, end, text }] : [];
  }).sort((first, second) => first.start - second.start);
}

export function activeSubtitle(cues: SubtitleCue[], position: number) {
  return cues.find((cue) => position >= cue.start && position < cue.end)?.text || '';
}
