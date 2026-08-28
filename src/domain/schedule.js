import { generateIcs } from './ics.js';

export const SCHEMA_VERSION = 1;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const REMINDER_MODES = new Set(['none', 'sameDay', 'previousDay']);

function requiredText(value, error) {
  const text = String(value ?? '').trim();
  if (!text || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error(error);
  return text;
}

function requiredId(value, error) {
  return requiredText(value, error);
}

export function validLocalDate(value) {
  if (!DATE_PATTERN.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDays(localDate, amount) {
  if (!validLocalDate(localDate) || !Number.isInteger(amount)) throw new Error('invalid_local_date');
  return new Date(Date.parse(`${localDate}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}

function requireSchemaVersion(input) {
  if (input?.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) throw new Error('unsupported_schema_version');
}

export function createReminder(input = { mode: 'none' }) {
  requireSchemaVersion(input);
  const mode = input?.mode ?? 'none';
  if (!REMINDER_MODES.has(mode)) throw new Error('invalid_reminder_mode');
  if (mode === 'none') return { schemaVersion: SCHEMA_VERSION, type: 'reminder', mode };
  if (!TIME_PATTERN.test(input.time ?? '')) throw new Error('invalid_reminder_time');
  return { schemaVersion: SCHEMA_VERSION, type: 'reminder', mode, time: input.time };
}

export function createAllDayPreset(input) {
  requireSchemaVersion(input);
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'allDayPreset',
    id: requiredId(input?.id, 'preset_id_required'),
    title: requiredText(input?.title, 'preset_title_required'),
    reminder: createReminder(input?.reminder),
  };
}

export function createCalendarProfile(input) {
  requireSchemaVersion(input);
  const presets = (input?.presets ?? []).map(createAllDayPreset);
  const presetIds = new Set();
  for (const preset of presets) {
    if (presetIds.has(preset.id)) throw new Error('duplicate_preset_id');
    presetIds.add(preset.id);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'calendarProfile',
    id: requiredId(input?.id, 'calendar_profile_id_required'),
    name: requiredText(input?.name, 'calendar_profile_name_required'),
    presets,
  };
}

export function createAssignment(input) {
  requireSchemaVersion(input);
  if (!validLocalDate(input?.date)) throw new Error('invalid_assignment_date');
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'assignment',
    calendarProfileId: requiredId(input?.calendarProfileId, 'assignment_calendar_profile_id_required'),
    presetId: requiredId(input?.presetId, 'assignment_preset_id_required'),
    date: input.date,
  };
}

export function assignmentKey(input) {
  const assignment = createAssignment(input);
  return `${assignment.calendarProfileId}\u001f${assignment.presetId}\u001f${assignment.date}`;
}

function compareAssignments(left, right) {
  return left.date.localeCompare(right.date)
    || left.calendarProfileId.localeCompare(right.calendarProfileId)
    || left.presetId.localeCompare(right.presetId);
}

export function toggleAssignment(assignments, input) {
  if (!Array.isArray(assignments)) throw new Error('assignments_required');
  const target = createAssignment(input);
  const targetKey = assignmentKey(target);
  const normalized = assignments.map(createAssignment);
  const matching = normalized.filter((assignment) => assignmentKey(assignment) === targetKey);
  if (matching.length > 1) throw new Error('duplicate_assignment');
  if (matching.length === 1) return normalized.filter((assignment) => assignmentKey(assignment) !== targetKey).sort(compareAssignments);
  return [...normalized, target].sort(compareAssignments);
}

export function mergeAssignments(assignments, inputs) {
  if (!Array.isArray(assignments) || !Array.isArray(inputs)) throw new Error('assignments_required');
  const normalized = assignments.map(createAssignment);
  const keys = new Set();
  for (const assignment of normalized) {
    const key = assignmentKey(assignment);
    if (keys.has(key)) throw new Error('duplicate_assignment');
    keys.add(key);
  }
  for (const input of inputs) {
    const assignment = createAssignment(input);
    const key = assignmentKey(assignment);
    if (keys.has(key)) continue;
    keys.add(key);
    normalized.push(assignment);
  }
  return normalized.sort(compareAssignments);
}

export function createExportRequest(input) {
  requireSchemaVersion(input);
  if (!validLocalDate(input?.startDate) || !validLocalDate(input?.endDate) || input.startDate > input.endDate) throw new Error('invalid_export_range');
  const request = {
    schemaVersion: SCHEMA_VERSION,
    type: 'exportRequest',
    calendarProfileId: requiredId(input?.calendarProfileId, 'export_calendar_profile_id_required'),
    startDate: input.startDate,
    endDate: input.endDate,
  };
  if (input.filename !== undefined) request.filename = sanitizeIcsFilename(input.filename);
  return request;
}

export function assignmentsForExport(assignments, requestInput) {
  if (!Array.isArray(assignments)) throw new Error('assignments_required');
  const request = createExportRequest(requestInput);
  const seen = new Set();
  return assignments.map(createAssignment).filter((assignment) => {
    const key = assignmentKey(assignment);
    if (seen.has(key)) throw new Error('duplicate_assignment');
    seen.add(key);
    return assignment.calendarProfileId === request.calendarProfileId
      && assignment.date >= request.startDate
      && assignment.date <= request.endDate;
  }).sort(compareAssignments);
}

function compactDate(localDate) {
  if (!validLocalDate(localDate)) throw new Error('invalid_local_date');
  return localDate.replaceAll('-', '');
}

export function sanitizeIcsFilename(value, fallback = 'LightCal') {
  const cleaned = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/-+/gu, '-')
    .replace(/^[ .-]+|[ .-]+$/gu, '');
  const withoutExtension = cleaned.replace(/(?:\.ics)+$/iu, '').replace(/[ .-]+$/gu, '');
  const fallbackBase = String(fallback ?? 'LightCal').replace(/[^\p{L}\p{N}_ -]+/gu, '').trim() || 'LightCal';
  return `${withoutExtension || fallbackBase}.ics`;
}

export function defaultExportFilename(calendarProfileInput, requestInput) {
  const profile = createCalendarProfile(calendarProfileInput);
  const request = createExportRequest(requestInput);
  if (request.calendarProfileId !== profile.id) throw new Error('export_calendar_profile_mismatch');
  return sanitizeIcsFilename(`${profile.name}_${compactDate(request.startDate)}-${compactDate(request.endDate)}`);
}

function reminderAtUtc(date, reminder) {
  if (reminder.mode === 'none') return undefined;
  const localDate = reminder.mode === 'previousDay' ? addDays(date, -1) : date;
  return new Date(`${localDate}T${reminder.time}:00+08:00`).toISOString();
}

export function assignmentUid(assignmentInput) {
  const assignment = createAssignment(assignmentInput);
  return `v1:${encodeURIComponent(assignment.calendarProfileId)}:${encodeURIComponent(assignment.presetId)}:${assignment.date}`;
}

export function buildScheduleExport({ calendarProfile: profileInput, assignments, request: requestInput, generatedAt = new Date() }) {
  const calendarProfile = createCalendarProfile(profileInput);
  const request = createExportRequest(requestInput);
  if (request.calendarProfileId !== calendarProfile.id) throw new Error('export_calendar_profile_mismatch');
  const selected = assignmentsForExport(assignments, request);
  if (selected.length === 0) throw new Error('export_events_required');
  const presets = new Map(calendarProfile.presets.map((preset, index) => [preset.id, { preset, index }]));
  const events = selected.map((assignment) => {
    const entry = presets.get(assignment.presetId);
    if (!entry) throw new Error('assignment_preset_not_found');
    return {
      presetOrder: entry.index,
      event: {
        id: assignmentUid(assignment),
        title: entry.preset.title,
        allDay: true,
        startDate: assignment.date,
        endDateExclusive: addDays(assignment.date, 1),
        reminderAt: reminderAtUtc(assignment.date, entry.preset.reminder),
      },
    };
  }).sort((left, right) => left.event.startDate.localeCompare(right.event.startDate)
    || left.presetOrder - right.presetOrder)
    .map(({ event }) => event);
  const filename = request.filename ?? defaultExportFilename(calendarProfile, request);
  return {
    schemaVersion: SCHEMA_VERSION,
    filename,
    events,
    ics: generateIcs(events, {
      calendarName: calendarProfile.name,
      generatedAt,
      productId: '-//LightCal ICS//G1//ZH-TW',
    }),
  };
}
