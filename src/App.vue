<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { buildMonthGrid, nextYearMonth, taipeiToday, yearMonthLabel } from './domain/month.js';
import {
  assignmentsForExport,
  buildScheduleExport,
  defaultExportFilename,
  toggleAssignment,
  validLocalDate,
} from './domain/schedule.js';
import {
  addCalendarProfile,
  createInitialWorkspace,
  createWorkspaceStorage,
  movePreset,
  overlappingExportRecords,
  recordExport,
  removeCalendarProfile,
  removePreset,
  renameCalendarProfile,
  savePreset as savePresetToWorkspace,
} from './domain/workspace.js';

const today = taipeiToday();
const storage = createWorkspaceStorage(window.localStorage, { today });
const loaded = storage.load();
const workspace = ref(loaded.workspace);
const managementOpen = ref(false);
const storageError = ref('');
const formError = ref('');
const exportError = ref('');
const downloadMessage = ref('');
const newProfileName = ref('');
const profileNameDraft = ref('');
const presetEditor = reactive({ id: '', title: '', mode: 'none', time: '09:00' });
const storageNotice = ref(({
  migrated: '已自動升級這台裝置上的舊版草稿。',
  recovered: '舊草稿無法讀取，原始內容已保留為 recovery copy，現在使用新的空白草稿。',
})[loaded.source] ?? '');

try { storage.save(workspace.value); } catch { storageError.value = '暫時無法儲存到這台裝置，請先不要關閉頁面。'; }

watch(workspace, (value) => {
  try {
    storage.save(value);
    storageError.value = '';
  } catch {
    storageError.value = '暫時無法儲存到這台裝置，請先不要關閉頁面。';
  }
}, { deep: true });

const currentProfile = computed(() => workspace.value.calendarProfiles.find((profile) => profile.id === workspace.value.activeCalendarProfileId));
const selectedPreset = computed(() => currentProfile.value.presets.find((preset) => preset.id === workspace.value.draft.selectedPresetId));
const activeAssignments = computed(() => workspace.value.assignments.filter((assignment) => assignment.calendarProfileId === currentProfile.value.id));
const cells = computed(() => buildMonthGrid(workspace.value.draft.pickerMonth, workspace.value.assignments, {
  calendarProfileId: currentProfile.value.id,
  today,
}));
const assignedDays = computed(() => new Set(activeAssignments.value.map((assignment) => assignment.date)).size);
const exportRangeValid = computed(() => validLocalDate(workspace.value.draft.exportStartDate)
  && validLocalDate(workspace.value.draft.exportEndDate)
  && workspace.value.draft.exportStartDate <= workspace.value.draft.exportEndDate);
const exportAssignments = computed(() => {
  if (!exportRangeValid.value) return [];
  return assignmentsForExport(workspace.value.assignments, {
    calendarProfileId: currentProfile.value.id,
    startDate: workspace.value.draft.exportStartDate,
    endDate: workspace.value.draft.exportEndDate,
  });
});
const exportDayCount = computed(() => new Set(exportAssignments.value.map((assignment) => assignment.date)).size);
const reminderCount = computed(() => {
  const presets = new Map(currentProfile.value.presets.map((preset) => [preset.id, preset]));
  return exportAssignments.value.filter((assignment) => presets.get(assignment.presetId)?.reminder.mode !== 'none').length;
});
const defaultFilename = computed(() => {
  if (!exportRangeValid.value) return 'LightCal.ics';
  return defaultExportFilename(currentProfile.value, {
    calendarProfileId: currentProfile.value.id,
    startDate: workspace.value.draft.exportStartDate,
    endDate: workspace.value.draft.exportEndDate,
  });
});
const filenameModel = computed({
  get: () => workspace.value.draft.filenameIsCustom ? workspace.value.draft.filename : defaultFilename.value,
  set: (value) => {
    workspace.value.draft.filename = value;
    workspace.value.draft.filenameIsCustom = true;
  },
});
const overlapRecords = computed(() => exportRangeValid.value ? overlappingExportRecords(workspace.value, {
  calendarProfileId: currentProfile.value.id,
  startDate: workspace.value.draft.exportStartDate,
  endDate: workspace.value.draft.exportEndDate,
}, { today }) : []);

function reminderLabel(reminder) {
  if (reminder.mode === 'none') return '不提醒';
  return `${reminder.mode === 'sameDay' ? '當天' : '前一天'} ${reminder.time}`;
}

function presetTitle(presetId) {
  return currentProfile.value.presets.find((preset) => preset.id === presetId)?.title ?? '已移除';
}

function activateProfile(calendarProfileId) {
  const profile = workspace.value.calendarProfiles.find((item) => item.id === calendarProfileId);
  if (!profile) return;
  workspace.value.activeCalendarProfileId = profile.id;
  workspace.value.draft.selectedPresetId = profile.presets[0]?.id ?? '';
  workspace.value.draft.filename = '';
  workspace.value.draft.filenameIsCustom = false;
  profileNameDraft.value = profile.name;
  resetPresetEditor();
  exportError.value = '';
  downloadMessage.value = '';
}

function toggleDate(localDate) {
  if (!selectedPreset.value) return;
  workspace.value.assignments = toggleAssignment(workspace.value.assignments, {
    calendarProfileId: currentProfile.value.id,
    presetId: selectedPreset.value.id,
    date: localDate,
  });
  downloadMessage.value = '';
}

function openManagement() {
  profileNameDraft.value = currentProfile.value.name;
  resetPresetEditor();
  formError.value = '';
  managementOpen.value = true;
}

function addProfile() {
  formError.value = '';
  try {
    workspace.value = addCalendarProfile(workspace.value, newProfileName.value, { today });
    newProfileName.value = '';
    profileNameDraft.value = currentProfile.value.name;
    resetPresetEditor();
  } catch (error) {
    formError.value = error.message === 'calendar_profile_name_required' ? '請輸入行事曆名稱。' : error.message;
  }
}

function saveProfileName() {
  formError.value = '';
  try {
    workspace.value = renameCalendarProfile(workspace.value, currentProfile.value.id, profileNameDraft.value, { today });
  } catch (error) {
    formError.value = error.message === 'calendar_profile_name_required' ? '行事曆名稱不能空白。' : error.message;
  }
}

function deleteProfile() {
  if (!window.confirm(`確定刪除「${currentProfile.value.name}」與它在此工具內的所有 assignment？已匯入 Apple Calendar 的事件不受影響。`)) return;
  formError.value = '';
  try {
    workspace.value = removeCalendarProfile(workspace.value, currentProfile.value.id, { today });
    profileNameDraft.value = currentProfile.value.name;
    resetPresetEditor();
  } catch (error) {
    formError.value = error.message === 'last_calendar_profile' ? '至少要保留一個行事曆。' : error.message;
  }
}

function resetPresetEditor() {
  Object.assign(presetEditor, { id: '', title: '', mode: 'none', time: '09:00' });
}

function editPreset(preset) {
  Object.assign(presetEditor, {
    id: preset.id,
    title: preset.title,
    mode: preset.reminder.mode,
    time: preset.reminder.time ?? '09:00',
  });
  formError.value = '';
}

function savePresetForm() {
  formError.value = '';
  try {
    workspace.value = savePresetToWorkspace(workspace.value, currentProfile.value.id, {
      id: presetEditor.id,
      title: presetEditor.title,
      reminder: presetEditor.mode === 'none'
        ? { mode: 'none' }
        : { mode: presetEditor.mode, time: presetEditor.time },
    }, { today });
    resetPresetEditor();
  } catch (error) {
    formError.value = ({
      preset_title_required: '請輸入常用項目名稱。',
      invalid_reminder_time: '請選擇有效提醒時間。',
    })[error.message] ?? error.message;
  }
}

function deletePreset(preset) {
  if (!window.confirm(`確定刪除「${preset.title}」？使用這個項目的日期 assignment 也會一併從草稿移除。`)) return;
  workspace.value = removePreset(workspace.value, currentProfile.value.id, preset.id, { today });
  resetPresetEditor();
}

function shiftPreset(presetId, offset) {
  workspace.value = movePreset(workspace.value, currentProfile.value.id, presetId, offset, { today });
}

function resetFilename() {
  workspace.value.draft.filename = '';
  workspace.value.draft.filenameIsCustom = false;
}

function downloadIcs() {
  exportError.value = '';
  downloadMessage.value = '';
  try {
    const generatedAt = new Date();
    const result = buildScheduleExport({
      calendarProfile: currentProfile.value,
      assignments: workspace.value.assignments,
      request: {
        calendarProfileId: currentProfile.value.id,
        startDate: workspace.value.draft.exportStartDate,
        endDate: workspace.value.draft.exportEndDate,
        filename: filenameModel.value,
      },
      generatedAt,
    });
    const url = URL.createObjectURL(new Blob([result.ics], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    workspace.value = recordExport(workspace.value, {
      id: crypto.randomUUID(),
      calendarProfileId: currentProfile.value.id,
      startDate: workspace.value.draft.exportStartDate,
      endDate: workspace.value.draft.exportEndDate,
      filename: result.filename,
      eventCount: result.events.length,
      createdAt: generatedAt.toISOString(),
    }, { today });
    downloadMessage.value = `已下載 ${result.filename}，共 ${result.events.length} 筆事件。`;
  } catch (error) {
    exportError.value = ({
      invalid_export_range: '請確認輸出開始日與結束日。',
      export_events_required: '這個範圍內還沒有 assignment。',
      assignment_preset_not_found: '有 assignment 對應不到常用項目，請重新選擇。',
    })[error.message] ?? error.message;
  }
}

function clearWorkspace() {
  if (!window.confirm('確定清除這台裝置內的所有行事曆設定、常用項目、assignment 與輸出紀錄？已匯入 Apple Calendar 的事件不受影響。')) return;
  storage.clear();
  workspace.value = createInitialWorkspace({ today });
  profileNameDraft.value = currentProfile.value.name;
  managementOpen.value = false;
  storageNotice.value = '已清除舊草稿並建立新的「我的班表」。';
  downloadMessage.value = '';
  exportError.value = '';
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <p class="brand-kicker">LightCal ICS</p>
        <h1>排班，點日期就好。</h1>
      </div>
      <button class="quiet-button" type="button" @click="openManagement">管理</button>
    </header>

    <section class="calendar-switcher" aria-label="目前行事曆">
      <label class="calendar-selector">
        <span class="section-label">行事曆</span>
        <select :value="currentProfile.id" aria-label="切換行事曆" @change="activateProfile($event.target.value)">
          <option v-for="profile in workspace.calendarProfiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
        </select>
      </label>
      <span class="local-badge">只存在這台裝置</span>
    </section>

    <p v-if="storageNotice" class="notice-message">{{ storageNotice }}</p>
    <p v-if="storageError" class="error-message">{{ storageError }}</p>

    <section v-if="managementOpen" class="management-panel" aria-label="行事曆與常用項目管理">
      <div class="management-heading">
        <div><p class="brand-kicker">本機設定</p><h2>管理 {{ currentProfile.name }}</h2></div>
        <button class="icon-close" type="button" aria-label="關閉管理" @click="managementOpen = false">×</button>
      </div>

      <div class="settings-block">
        <h3>行事曆設定檔</h3>
        <div class="inline-form">
          <label class="grow-field">目前名稱<input v-model="profileNameDraft" maxlength="80" autocomplete="off"></label>
          <button class="secondary-button" type="button" @click="saveProfileName">儲存名稱</button>
        </div>
        <form class="inline-form add-profile-form" @submit.prevent="addProfile">
          <label class="grow-field">新增另一個行事曆<input v-model="newProfileName" maxlength="80" autocomplete="off" placeholder="例如：家庭行程"></label>
          <button class="secondary-button" type="submit">建立並切換</button>
        </form>
      </div>

      <div class="settings-block">
        <div class="settings-title-row"><h3>全天常用項目</h3><span>{{ currentProfile.presets.length }} 個</span></div>
        <div v-if="currentProfile.presets.length" class="preset-editor-list">
          <article v-for="(preset, index) in currentProfile.presets" :key="preset.id" class="preset-editor-item">
            <div><strong>{{ preset.title }}</strong><small>{{ reminderLabel(preset.reminder) }}</small></div>
            <div class="compact-actions">
              <button type="button" :disabled="index === 0" :aria-label="`上移 ${preset.title}`" @click="shiftPreset(preset.id, -1)">↑</button>
              <button type="button" :disabled="index === currentProfile.presets.length - 1" :aria-label="`下移 ${preset.title}`" @click="shiftPreset(preset.id, 1)">↓</button>
              <button type="button" @click="editPreset(preset)">編輯</button>
              <button class="text-danger" type="button" @click="deletePreset(preset)">刪除</button>
            </div>
          </article>
        </div>
        <p v-else class="empty-copy">還沒有常用項目。新增一個後，就能直接點日期排入。</p>

        <form class="preset-form" @submit.prevent="savePresetForm">
          <label>名稱<input v-model="presetEditor.title" maxlength="80" autocomplete="off" placeholder="例如：07-16、休假"></label>
          <label>提醒
            <select v-model="presetEditor.mode">
              <option value="none">不提醒</option>
              <option value="sameDay">當天</option>
              <option value="previousDay">前一天</option>
            </select>
          </label>
          <label v-if="presetEditor.mode !== 'none'">時間<input v-model="presetEditor.time" type="time"></label>
          <div class="preset-form-actions">
            <button class="primary-button" type="submit">{{ presetEditor.id ? '儲存修改' : '新增項目' }}</button>
            <button v-if="presetEditor.id" class="secondary-button" type="button" @click="resetPresetEditor">取消編輯</button>
          </div>
        </form>
      </div>

      <p v-if="formError" class="error-message">{{ formError }}</p>
      <div class="danger-zone">
        <div><strong>清除本機草稿</strong><small>會清除設定、assignment 與輸出紀錄，不影響 Apple Calendar。</small></div>
        <button class="danger-button" type="button" @click="clearWorkspace">全部清除</button>
      </div>
      <button v-if="workspace.calendarProfiles.length > 1" class="delete-profile-button" type="button" @click="deleteProfile">刪除「{{ currentProfile.name }}」</button>
    </section>

    <section class="preset-section" aria-labelledby="preset-heading">
      <div class="section-heading">
        <div><span class="step-number">1</span><h2 id="preset-heading">先選常用項目</h2></div>
        <span v-if="selectedPreset" class="selection-note">{{ selectedPreset.title }} · {{ reminderLabel(selectedPreset.reminder) }}</span>
      </div>
      <div v-if="currentProfile.presets.length" class="preset-rail">
        <button
          v-for="preset in currentProfile.presets"
          :key="preset.id"
          class="preset-chip"
          :class="{ selected: preset.id === workspace.draft.selectedPresetId }"
          type="button"
          :aria-pressed="preset.id === workspace.draft.selectedPresetId"
          @click="workspace.draft.selectedPresetId = preset.id"
        >
          <strong>{{ preset.title }}</strong>
          <small>{{ reminderLabel(preset.reminder) }}</small>
        </button>
      </div>
      <button v-else class="empty-action" type="button" @click="openManagement">先新增常用項目</button>
    </section>

    <section class="picker-section" aria-labelledby="picker-heading">
      <div class="section-heading picker-heading">
        <div><span class="step-number">2</span><h2 id="picker-heading">再點日期</h2></div>
        <strong class="assignment-count">{{ activeAssignments.length }} 筆 · {{ assignedDays }} 天</strong>
      </div>

      <div class="month-toolbar">
        <button type="button" aria-label="上個月" @click="workspace.draft.pickerMonth = nextYearMonth(workspace.draft.pickerMonth, -1)">‹</button>
        <h3>{{ yearMonthLabel(workspace.draft.pickerMonth) }}</h3>
        <button type="button" aria-label="下個月" @click="workspace.draft.pickerMonth = nextYearMonth(workspace.draft.pickerMonth, 1)">›</button>
      </div>

      <div class="month-grid" aria-label="跨月日期選擇器">
        <span v-for="weekday in ['日', '一', '二', '三', '四', '五', '六']" :key="weekday" class="weekday">{{ weekday }}</span>
        <button
          v-for="cell in cells"
          :key="cell.localDate"
          class="date-cell"
          :class="{ outside: !cell.inMonth, today: cell.isToday, selected: cell.assignments.some((item) => item.presetId === workspace.draft.selectedPresetId) }"
          type="button"
          :disabled="!cell.inMonth || !selectedPreset"
          :aria-label="`${cell.localDate}，${cell.assignments.length} 個項目`"
          :aria-pressed="cell.assignments.some((item) => item.presetId === workspace.draft.selectedPresetId)"
          @click="toggleDate(cell.localDate)"
        >
          <span class="day-number">{{ cell.day }}</span>
          <span v-if="cell.assignments.length" class="date-items">
            <i v-for="item in cell.assignments.slice(0, 3)" :key="item.presetId">{{ presetTitle(item.presetId) }}</i>
          </span>
        </button>
      </div>
      <p class="picker-help">換月份不會清除已選日期；同一天可以安排多個不同項目。</p>
    </section>

    <section class="export-section" aria-labelledby="export-heading">
      <div class="section-heading export-heading">
        <div><span class="step-number">3</span><h2 id="export-heading">確認範圍並下載</h2></div>
        <strong>{{ exportAssignments.length }} 筆事件</strong>
      </div>
      <div class="export-fields">
        <label>開始日<input v-model="workspace.draft.exportStartDate" type="date"></label>
        <label>結束日<input v-model="workspace.draft.exportEndDate" type="date" :min="workspace.draft.exportStartDate"></label>
      </div>
      <div class="filename-row">
        <label class="grow-field">檔名<input v-model="filenameModel" maxlength="180" autocomplete="off"></label>
        <button class="secondary-button" type="button" @click="resetFilename">恢復預設</button>
      </div>
      <div class="export-summary">
        <div><span>行事曆</span><strong>{{ currentProfile.name }}</strong></div>
        <div><span>內容</span><strong>{{ exportAssignments.length }} 筆／{{ exportDayCount }} 天</strong></div>
        <div><span>提醒</span><strong>{{ reminderCount }} 筆</strong></div>
      </div>
      <p v-if="!exportRangeValid" class="error-message">結束日不能早於開始日。</p>
      <p v-else-if="!exportAssignments.length" class="empty-copy">這個範圍內還沒有 assignment。</p>
      <p v-if="overlapRecords.length" class="overlap-warning">這個日期範圍與 {{ overlapRecords.length }} 次先前輸出重疊。Apple 不保證重複匯入會自動去重，請確認後再下載。</p>
      <p v-if="exportError" class="error-message">{{ exportError }}</p>
      <p v-if="downloadMessage" class="success-message">{{ downloadMessage }}</p>
      <button class="primary-button download-button" type="button" :disabled="!exportRangeValid || !exportAssignments.length" @click="downloadIcs">下載 .ics</button>
      <p class="apple-boundary">下載後由你選擇要匯入的 Apple Calendar；本工具不會讀回、覆寫或同步已匯入事件。</p>
    </section>
  </main>
</template>
