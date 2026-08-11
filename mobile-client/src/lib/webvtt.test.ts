import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSubtitle, parseWebVtt } from './webvtt';

test('WebVTT parser accepts identifiers, hours, tags, and comma timestamps', () => {
  const cues = parseWebVtt(`WEBVTT\n\nintro\n00:00:01.500 --> 00:00:03.000 align:middle\n<i>Hello</i><br>lounge\n\n00:04,000 --> 00:06,000\nNext &amp; final`);
  assert.deepEqual(cues, [
    { start: 1.5, end: 3, text: 'Hello\nlounge' },
    { start: 4, end: 6, text: 'Next & final' },
  ]);
  assert.equal(activeSubtitle(cues, 2), 'Hello\nlounge');
  assert.equal(activeSubtitle(cues, 3.5), '');
});
