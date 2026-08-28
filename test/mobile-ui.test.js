import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('G6 published ICS links navigate in the current context on iOS PWA', async () => {
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8');
  assert.match(source, /class="safari-button" :href="publishedResult\.publicUrl"/u);
  assert.doesNotMatch(source, /class="(?:public-url|safari-button)"[^>]*target="_blank"/u);
});

test('G6 date range fields stack and allow shrinking on narrow screens', async () => {
  const source = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(source, /\.export-fields > label, \.export-fields input\[type="date"\] \{ min-width: 0; \}/u);
  assert.match(source, /@media \(max-width: 520px\)[\s\S]*\.export-fields \{ grid-template-columns: minmax\(0, 1fr\); \}/u);
});
