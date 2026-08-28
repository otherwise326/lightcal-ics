import {
  SCHEMA_VERSION,
  addDays,
  assignmentKey,
  createAllDayPreset,
  createAssignment,
  createCalendarProfile,
  validLocalDate,
} from './schedule.js';
import { nextYearMonth, validYearMonth } from './month.js';

export const WORKSPACE_SCHEMA_VERSION = 1;
export const WORKSPACE_STORAGE_KEY = 'lightcal-ics.workspace';

function monthBounds(localDate) {
  const yearMonth = localDate.slice(0, 7);
  return {
    startDate: `${yearMonth}-01`,
    endDate: addDays(`${nextYearMonth(yearMonth, 1)}-01`, -1),
  };
}

function defaultProfile() {
  return createCalendarProfile({
    id: 'default',
    name: '我的班表',
    presets: [
      { id: 'day-shift', title: '07-16', reminder: { mode: 'none' } },
      { id: 'night-shift', title: '12-22', reminder: { mode: 'none' } },
      { id: 'day-off', title: '休假', reminder: { mode: 'none' } },
    ],
  });
}

export function createInitialWorkspace({ today } = {}) {
  if (!validLocalDate(today)) throw new Error('invalid_today');
  const profile = defaultProfile();
  const bounds = monthBounds(today);
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    type: 'workspace',
    calendarProfiles: [profile],
    activeCalendarProfileId: profile.id,
    assignments: [],
    exportRecords: [],
    draft: {
      pickerMonth: today.slice(0, 7),
      selectedPresetId: profile.presets[0].id,
      exportStartDate: bounds.startDate,
      exportEndDate: bounds.endDate,
      filename: '',
      filenameIsCustom: false,
    },
  };
}

function normalizeExportRecord(input) {
  if (!validLocalDate(input?.startDate) || !validLocalDate(input?.endDate) || input.startDate > input.endDate) throw new Error('invalid_export_record_range');
  const createdAt = new Date(input.createdAt);
  if (!Number.isFinite(createdAt.valueOf())) throw new Error('invalid_export_record_time');
  if (!Number.isInteger(input.eventCount) || input.eventCount < 1) throw new Error('invalid_export_record_count');
  return {
    id: String(input.id ?? '').trim() || createdAt.toISOString(),
    calendarProfileId: String(input.calendarProfileId ?? '').trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    filename: String(input.filename ?? '').trim(),
    eventCount: input.eventCount,
    createdAt: createdAt.toISOString(),
  };
}

export function normalizeWorkspace(input, { today } = {}) {
  if (!validLocalDate(today)) throw new Error('invalid_today');
  if (input?.schemaVersion !== WORKSPACE_SCHEMA_VERSION || input?.type !== 'workspace') throw new Error('unsupported_workspace_schema');
  const calendarProfiles = (input.calendarProfiles ?? []).map(createCalendarProfile);
  if (!calendarProfiles.length) throw new Error('calendar_profile_required');
  const profileIds = new Set();
  for (const profile of calendarProfiles) {
    if (profileIds.has(profile.id)) throw new Error('duplicate_calendar_profile_id');
    profileIds.add(profile.id);
  }
  const activeCalendarProfileId = profileIds.has(input.activeCalendarProfileId)
    ? input.activeCalendarProfileId
    : calendarProfiles[0].id;
  const presetsByProfile = new Map(calendarProfiles.map((profile) => [profile.id, new Set(profile.presets.map((preset) => preset.id))]));
  const assignmentKeys = new Set();
  const assignments = (input.assignments ?? []).map(createAssignment);
  for (const assignment of assignments) {
    const key = assignmentKey(assignment);
    if (assignmentKeys.has(key)) throw new Error('duplicate_assignment');
    if (!presetsByProfile.get(assignment.calendarProfileId)?.has(assignment.presetId)) throw new Error('assignment_reference_not_found');
    assignmentKeys.add(key);
  }
  const activeProfile = calendarProfiles.find((profile) => profile.id === activeCalendarProfileId);
  const fallbackBounds = monthBounds(today);
  const draftInput = input.draft ?? {};
  const pickerMonth = validYearMonth(draftInput.pickerMonth) ? draftInput.pickerMonth : today.slice(0, 7);
  const validRange = validLocalDate(draftInput.exportStartDate)
    && validLocalDate(draftInput.exportEndDate)
    && draftInput.exportStartDate <= draftInput.exportEndDate;
  const selectedPresetId = activeProfile.presets.some((preset) => preset.id === draftInput.selectedPresetId)
    ? draftInput.selectedPresetId
    : (activeProfile.presets[0]?.id ?? '');
  const exportRecords = (input.exportRecords ?? []).map(normalizeExportRecord)
    .filter((record) => profileIds.has(record.calendarProfileId))
    .slice(-20);
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    type: 'workspace',
    calendarProfiles,
    activeCalendarProfileId,
    assignments: assignments.sort((left, right) => left.date.localeCompare(right.date) || left.presetId.localeCompare(right.presetId)),
    exportRecords,
    draft: {
      pickerMonth,
      selectedPresetId,
      exportStartDate: validRange ? draftInput.exportStartDate : fallbackBounds.startDate,
      exportEndDate: validRange ? draftInput.exportEndDate : fallbackBounds.endDate,
      filename: String(draftInput.filename ?? '').slice(0, 180),
      filenameIsCustom: draftInput.filenameIsCustom === true,
    },
  };
}

export function migrateLegacyWorkspace(input, { today } = {}) {
  const version = input?.schemaVersion ?? input?.version;
  if (![0, undefined].includes(version)) throw new Error('unsupported_workspace_schema');
  const calendars = Array.isArray(input?.calendars) ? input.calendars : [];
  if (!calendars.length) return createInitialWorkspace({ today });
  const calendarProfiles = calendars.map((calendar) => createCalendarProfile({
    id: calendar.id,
    name: calendar.name ?? calendar.title,
    presets: (calendar.presets ?? []).map((preset) => ({
      id: preset.id,
      title: preset.title,
      reminder: preset.reminderMode && preset.reminderMode !== 'none'
        ? { mode: preset.reminderMode, time: preset.reminderTime }
        : { mode: 'none' },
    })),
  }));
  const firstProfile = calendarProfiles[0];
  const legacyRange = input.exportRange ?? {};
  return normalizeWorkspace({
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    type: 'workspace',
    calendarProfiles,
    activeCalendarProfileId: input.activeCalendarProfileId ?? input.activeCalendarId ?? firstProfile.id,
    assignments: (input.assignments ?? input.selections ?? []).map((item) => ({
      schemaVersion: SCHEMA_VERSION,
      calendarProfileId: item.calendarProfileId ?? item.calendarId,
      presetId: item.presetId,
      date: item.date ?? item.localDate,
    })),
    exportRecords: input.exportRecords ?? [],
    draft: {
      pickerMonth: input.pickerMonth ?? today.slice(0, 7),
      selectedPresetId: input.selectedPresetId ?? firstProfile.presets[0]?.id ?? '',
      exportStartDate: legacyRange.startDate,
      exportEndDate: legacyRange.endDate,
      filename: input.filename ?? '',
      filenameIsCustom: Boolean(input.filename),
    },
  }, { today });
}

export function createWorkspaceStorage(storage, { key = WORKSPACE_STORAGE_KEY, today } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new Error('storage_adapter_required');
  if (!validLocalDate(today)) throw new Error('invalid_today');
  return {
    load() {
      const raw = storage.getItem(key);
      if (!raw) return { workspace: createInitialWorkspace({ today }), source: 'initial' };
      try {
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion === WORKSPACE_SCHEMA_VERSION && parsed.type === 'workspace') {
          return { workspace: normalizeWorkspace(parsed, { today }), source: 'stored' };
        }
        return { workspace: migrateLegacyWorkspace(parsed, { today }), source: 'migrated' };
      } catch {
        storage.setItem(`${key}.recovery`, raw);
        return { workspace: createInitialWorkspace({ today }), source: 'recovered' };
      }
    },
    save(workspace) {
      const normalized = normalizeWorkspace(workspace, { today });
      storage.setItem(key, JSON.stringify(normalized));
      return normalized;
    },
    clear() {
      storage.removeItem(key);
      storage.removeItem(`${key}.recovery`);
    },
  };
}

export function addCalendarProfile(workspaceInput, name, { id = crypto.randomUUID(), today } = {}) {
  const workspace = normalizeWorkspace(workspaceInput, { today });
  const profile = createCalendarProfile({ id, name, presets: [] });
  workspace.calendarProfiles.push(profile);
  workspace.activeCalendarProfileId = profile.id;
  workspace.draft.selectedPresetId = '';
  workspace.draft.filename = '';
  workspace.draft.filenameIsCustom = false;
  return workspace;
}

export function renameCalendarProfile(workspaceInput, calendarProfileId, name, { today } = {}) {
  const workspace = normalizeWorkspace(workspaceInput, { today });
  const index = workspace.calendarProfiles.findIndex((profile) => profile.id === calendarProfileId);
  if (index < 0) throw new Error('calendar_profile_not_found');
  workspace.calendarProfiles[index] = createCalendarProfile({ ...workspace.calendarProfiles[index], name });
  return workspace;
}

export function removeCalendarProfile(workspaceInput, calendarProfileId, { today } = {}) {
  const workspace = normalizeWorkspace(workspaceInput, { today });
  if (workspace.calendarProfiles.length === 1) throw new Error('last_calendar_profile');
  if (!workspace.calendarProfiles.some((profile) => profile.id === calendarProfileId)) throw new Error('calendar_profile_not_found');
  workspace.calendarProfiles = workspace.calendarProfiles.filter((profile) => profile.id !== calendarProfileId);
  workspace.assignments = workspace.assignments.filter((assignment) => assignment.calendarProfileId !== calendarProfileId);
  workspace.exportRecords = workspace.exportRecords.filter((record) => record.calendarProfileId !== calendarProfileId);
  workspace.activeCalendarProfileId = workspace.calendarProfiles[0].id;
  workspace.draft.selectedPresetId = workspace.calendarProfiles[0].presets[0]?.id ?? '';
  workspace.draft.filename = '';
  workspace.draft.filenameIsCustom = false;
  return workspace;
}

export function savePreset(workspaceInput, calendarProfileId, input, { id = crypto.randomUUID(), today } = {}) {
  const workspace = normalizeWorkspace(workspaceInput, { today });
  const profileIndex = workspace.calendarProfiles.findIndex((profile) => profile.id === calendarProfileId);
  if (profileIndex < 0) throw new Error('calendar_profile_not_found');
  const profile = workspace.calendarProfiles[profileIndex];
  const preset = createAllDayPreset({ ...input, id: input.id || id });
  const presetIndex = profile.presets.findIndex((item) => item.id === preset.id);
  const presets = [...profile.presets];
  if (presetIndex < 0) presets.push(preset);
  else presets[presetIndex] = preset;
  workspace.calendarProfiles[profileIndex] = createCalendarProfile({ ...profile, presets });
  if (!workspace.draft.selectedPresetId) workspace.draft.selectedPresetId = preset.id;
  return workspace;
}

export function removePreset(workspaceInput, calendarProfileId, presetId, { today } = {}) {
  const workspace = normalizeWorkspace(workspaceInput, { today });
  const profileIndex = workspace.calendarProfiles.findIndex((profile) => profile.id === calendarProfileId);
  if (profileIndex < 0) throw new Error('calendar_profile_not_found');
  const profile = workspace.calendarProfiles[profileIndex];
  if (!profile.presets.some((preset) => preset.id === presetId)) throw new Error('preset_not_found');
  const presets = profile.presets.filter((preset) => preset.id !== presetId);
  workspace.calendarProfiles[profileIndex] = createCalendarProfile({ ...profile, presets });
  workspace.assignments = workspace.assignments.filter((assignment) => assignment.calendarProfileId !== calendarProfileId || assignment.presetId !== presetId);
  if (workspace.draft.selectedPresetId === presetId) workspace.draft.selectedPresetId = presets[0]?.id ?? '';
  return workspace;
}

export function movePreset(workspaceInput, calendarProfileId, presetId, offset, { today } = {}) {
  const workspace = normalizeWorkspace(workspaceInput, { today });
  if (![1, -1].includes(offset)) throw new Error('invalid_preset_move');
  const profileIndex = workspace.calendarProfiles.findIndex((profile) => profile.id === calendarProfileId);
  if (profileIndex < 0) throw new Error('calendar_profile_not_found');
  const profile = workspace.calendarProfiles[profileIndex];
  const current = profile.presets.findIndex((preset) => preset.id === presetId);
  const target = current + offset;
  if (current < 0) throw new Error('preset_not_found');
  if (target < 0 || target >= profile.presets.length) return workspace;
  const presets = [...profile.presets];
  [presets[current], presets[target]] = [presets[target], presets[current]];
  workspace.calendarProfiles[profileIndex] = createCalendarProfile({ ...profile, presets });
  return workspace;
}

export function overlappingExportRecords(workspaceInput, { calendarProfileId, startDate, endDate }, { today } = {}) {
  const workspace = normalizeWorkspace(workspaceInput, { today });
  if (!validLocalDate(startDate) || !validLocalDate(endDate) || startDate > endDate) return [];
  return workspace.exportRecords.filter((record) => record.calendarProfileId === calendarProfileId
    && record.startDate <= endDate
    && record.endDate >= startDate);
}

export function recordExport(workspaceInput, record, { today } = {}) {
  const workspace = normalizeWorkspace(workspaceInput, { today });
  const normalized = normalizeExportRecord(record);
  if (!workspace.calendarProfiles.some((profile) => profile.id === normalized.calendarProfileId)) throw new Error('calendar_profile_not_found');
  workspace.exportRecords = [...workspace.exportRecords, normalized].slice(-20);
  return workspace;
}
