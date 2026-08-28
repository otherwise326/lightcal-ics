import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateIcs } from '../src/domain/ics.js';
import { G0_CALENDAR_NAME, G0_EVENTS, G0_GENERATED_AT, G0_OUTPUT_NAME } from '../src/fixtures/g0.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(projectRoot, 'public');
const outputPath = resolve(outputDirectory, G0_OUTPUT_NAME);
const ics = generateIcs(G0_EVENTS, { calendarName: G0_CALENDAR_NAME, generatedAt: G0_GENERATED_AT });

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, ics, 'utf8');
console.log(`Generated ${G0_EVENTS.length} events: ${outputPath}`);
