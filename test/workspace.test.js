import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarProfile,
  createInitialWorkspace,
  createWorkspaceStorage,
  migrateLegacyWorkspace,
  movePreset,
  overlappingExportRecords,
  recordExport,
  removeCalendarProfile,
  removePreset,
  renameCalendarProfile,
  savePreset,
} from '../src/domain/workspace.js';

const TODAY = '2026-08-28';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('G2 first load creates a versioned local workspace with useful defaults', () => {
  const workspace = createInitialWorkspace({ today: TODAY });
  assert.equal(workspace.schemaVersion, 1);
  assert.equal(workspace.type, 'workspace');
  assert.equal(workspace.calendarProfiles[0].name, '我的班表');
  assert.deepEqual(workspace.calendarProfiles[0].presets.map(({ title }) => title), ['07-16', '12-22', '休假']);
  assert.deepEqual([workspace.draft.exportStartDate, workspace.draft.exportEndDate], ['2026-08-01', '2026-08-31']);
});

test('G2 storage restores a saved workspace and preserves malformed raw data for recovery', () => {
  const storage = memoryStorage();
  const adapter = createWorkspaceStorage(storage, { today: TODAY });
  const initial = adapter.load();
  assert.equal(initial.source, 'initial');
  initial.workspace.assignments.push({ calendarProfileId: 'default', presetId: 'day-shift', date: '2026-08-31' });
  adapter.save(initial.workspace);
  assert.equal(adapter.load().source, 'stored');
  assert.equal(adapter.load().workspace.assignments[0].date, '2026-08-31');
  storage.setItem('lightcal-ics.workspace', '{broken');
  const recovered = adapter.load();
  assert.equal(recovered.source, 'recovered');
  assert.equal(storage.getItem('lightcal-ics.workspace.recovery'), '{broken');
});

test('G2 storage clear removes both the active draft and recovery copy', () => {
  const storage = memoryStorage({
    'lightcal-ics.workspace': '{"schemaVersion":1}',
    'lightcal-ics.workspace.recovery': '{broken',
  });
  createWorkspaceStorage(storage, { today: TODAY }).clear();
  assert.equal(storage.getItem('lightcal-ics.workspace'), null);
  assert.equal(storage.getItem('lightcal-ics.workspace.recovery'), null);
});

test('G2 migrates the legacy v0 calendar, reminder, assignment, and export range shape', () => {
  const migrated = migrateLegacyWorkspace({
    version: 0,
    activeCalendarId: 'legacy',
    calendars: [{ id: 'legacy', title: '舊班表', presets: [{ id: 'day', title: '早班', reminderMode: 'sameDay', reminderTime: '06:30' }] }],
    selections: [{ calendarId: 'legacy', presetId: 'day', localDate: '2026-09-01' }],
    pickerMonth: '2026-09',
    selectedPresetId: 'day',
    exportRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
  }, { today: TODAY });
  assert.equal(migrated.calendarProfiles[0].name, '舊班表');
  assert.deepEqual(migrated.calendarProfiles[0].presets[0].reminder, { schemaVersion: 1, type: 'reminder', mode: 'sameDay', time: '06:30' });
  assert.equal(migrated.assignments[0].date, '2026-09-01');
  assert.equal(migrated.draft.exportEndDate, '2026-09-30');
});

test('G2 profile and preset management is local, ordered, and removes orphan assignments', () => {
  let workspace = createInitialWorkspace({ today: TODAY });
  workspace = addCalendarProfile(workspace, '家庭', { id: 'family', today: TODAY });
  workspace = renameCalendarProfile(workspace, 'family', '家庭班表', { today: TODAY });
  workspace = savePreset(workspace, 'family', { title: '陪診', reminder: { mode: 'previousDay', time: '20:00' } }, { id: 'appointment', today: TODAY });
  workspace = savePreset(workspace, 'family', { title: '休息', reminder: { mode: 'none' } }, { id: 'rest', today: TODAY });
  workspace = movePreset(workspace, 'family', 'rest', -1, { today: TODAY });
  assert.deepEqual(workspace.calendarProfiles.find(({ id }) => id === 'family').presets.map(({ id }) => id), ['rest', 'appointment']);
  workspace.assignments.push({ calendarProfileId: 'family', presetId: 'appointment', date: '2026-09-02' });
  workspace = removePreset(workspace, 'family', 'appointment', { today: TODAY });
  assert.equal(workspace.assignments.length, 0);
  workspace = removeCalendarProfile(workspace, 'family', { today: TODAY });
  assert.equal(workspace.activeCalendarProfileId, 'default');
  assert.throws(() => removeCalendarProfile(workspace, 'default', { today: TODAY }), /last_calendar_profile/);
});

test('G2 export records detect overlapping date ranges without claiming deduplication', () => {
  let workspace = createInitialWorkspace({ today: TODAY });
  workspace = recordExport(workspace, {
    id: 'first', calendarProfileId: 'default', startDate: '2026-08-10', endDate: '2026-08-20',
    filename: '班表.ics', eventCount: 6, createdAt: '2026-08-28T05:00:00.000Z',
  }, { today: TODAY });
  assert.equal(overlappingExportRecords(workspace, { calendarProfileId: 'default', startDate: '2026-08-20', endDate: '2026-08-25' }, { today: TODAY }).length, 1);
  assert.equal(overlappingExportRecords(workspace, { calendarProfileId: 'default', startDate: '2026-08-21', endDate: '2026-08-25' }, { today: TODAY }).length, 0);
});
