const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;
const encoder = new TextEncoder();

function validDate(value) {
  if (!DATE_PATTERN.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validLocalDateTime(value) {
  return LOCAL_DATE_TIME_PATTERN.test(value ?? '') && validDate(value.slice(0, 10));
}

function requiredText(value, error) {
  const text = String(value ?? '').trim();
  if (!text || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new Error(error);
  return text;
}

function requiredIdentifier(value, error) {
  const text = String(value ?? '').trim();
  if (!text || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error(error);
  return text;
}

export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

export function foldIcsLine(line) {
  if (/\r|\n/.test(line)) throw new Error('ics_content_line_has_newline');
  const physicalLines = [];
  let current = '';
  let currentBytes = 0;
  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (currentBytes + characterBytes > 75) {
      physicalLines.push(current);
      current = ` ${character}`;
      currentBytes = 1 + characterBytes;
    } else {
      current += character;
      currentBytes += characterBytes;
    }
  }
  physicalLines.push(current);
  return physicalLines.join('\r\n');
}

function compactDate(value) {
  if (!validDate(value)) throw new Error('invalid_event_date');
  return value.replaceAll('-', '');
}

function compactLocalDateTime(value) {
  if (!validLocalDateTime(value)) throw new Error('invalid_event_time');
  return `${value.slice(0, 10).replaceAll('-', '')}T${value.slice(11).replace(':', '')}00`;
}

function utcStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error('invalid_generated_at');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function stableUid(event) {
  const id = requiredIdentifier(event.id, 'event_id_required');
  return `${encodeURIComponent(id)}@lightcal-ics.local`;
}

function eventLines(event, generatedAt) {
  const title = requiredText(event.title, 'event_title_required');
  const sequence = event.sequence ?? 0;
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error('invalid_event_sequence');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${stableUid(event)}`,
    `DTSTAMP:${utcStamp(generatedAt)}`,
    `LAST-MODIFIED:${utcStamp(event.lastModified ?? generatedAt)}`,
    `SEQUENCE:${sequence}`,
  ];

  if (event.allDay === true) {
    if (!validDate(event.startDate) || !validDate(event.endDateExclusive) || event.startDate >= event.endDateExclusive) throw new Error('invalid_all_day_range');
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(event.endDateExclusive)}`);
  } else {
    if (!validLocalDateTime(event.startLocal) || !validLocalDateTime(event.endLocal) || event.startLocal >= event.endLocal) throw new Error('invalid_timed_range');
    lines.push(`DTSTART;TZID=Asia/Taipei:${compactLocalDateTime(event.startLocal)}`);
    lines.push(`DTEND;TZID=Asia/Taipei:${compactLocalDateTime(event.endLocal)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);

  if (event.reminderMinutesBefore !== undefined) {
    const minutes = event.reminderMinutesBefore;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 40_320) throw new Error('invalid_reminder_minutes');
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${escapeIcsText(event.reminderDescription ?? title)}`);
    lines.push(`TRIGGER:-PT${minutes}M`);
    lines.push('END:VALARM');
  }

  lines.push('END:VEVENT');
  return lines;
}

export function generateIcs(events, { calendarName = 'LightCal ICS', generatedAt = new Date() } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('events_required');
  const name = requiredText(calendarName, 'calendar_name_required');
  const ids = new Set();
  for (const event of events) {
    const id = requiredIdentifier(event?.id, 'event_id_required');
    if (ids.has(id)) throw new Error('duplicate_event_id');
    ids.add(id);
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//LightCal ICS//G0//ZH-TW',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    'X-WR-TIMEZONE:Asia/Taipei',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Taipei',
    'X-LIC-LOCATION:Asia/Taipei',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...events.flatMap((event) => eventLines(event, generatedAt)),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
