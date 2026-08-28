<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
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
import {
  createPublisherCredentialStorage,
  normalizePublisherEndpoint,
  publishIcs as publishIcsToServer,
  waitForPublishedIcs,
} from './domain/publisher-client.js';
import { registerPwa } from './pwa.js';

const today = taipeiToday();
const storage = createWorkspaceStorage(window.localStorage, { today });
const publisherCredentialStorage = createPublisherCredentialStorage(window.localStorage);
const loaded = storage.load();
const workspace = ref(loaded.workspace);
const managementOpen = ref(false);
const storageError = ref('');
const formError = ref('');
const exportError = ref('');
const downloadMessage = ref('');
const publisherToken = ref(publisherCredentialStorage.load());
const publisherTokenDraft = ref('');
const publisherCredentialError = ref('');
const publishBusy = ref(false);
const publishError = ref('');
const publishMessage = ref('');
const publishedResult = ref(null);
const publishedFingerprint = ref('');
const publishedIcs = ref('');
const publicationReady = ref(false);
const publicationCheckBusy = ref(false);
const publicationCheckError = ref('');
let publicationCheckId = 0;
const pwaUpdateAvailable = ref(false);
const pwaUpdateError = ref('');
let activatePwaUpdate = null;
const newProfileName = ref('');
const profileNameDraft = ref('');
const presetEditor = reactive({ id: '', title: '', mode: 'none', time: '09:00' });
const storageNotice = ref(({
  migrated: '已自動升級這台裝置上的舊版草稿。',
  recovered: '舊草稿無法讀取，原始內容已保留為 recovery copy，現在使用新的空白草稿。',
})[loaded.source] ?? '');
let publisherEndpoint = '';
let publisherEndpointError = '';
try {
  publisherEndpoint = normalizePublisherEndpoint(import.meta.env.VITE_PUBLISHER_ENDPOINT ?? '');
} catch {
  publisherEndpointError = '發布服務網址設定無效；目前只能下載或分享。';
}

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
const publisherConfigured = computed(() => Boolean(publisherEndpoint));
const publisherCredentialConfigured = computed(() => Boolean(publisherToken.value));
const exportFingerprint = computed(() => JSON.stringify({
  profile: currentProfile.value,
  assignments: exportAssignments.value,
  startDate: workspace.value.draft.exportStartDate,
  endDate: workspace.value.draft.exportEndDate,
  filename: filenameModel.value,
}));
const publicationCurrent = computed(() => Boolean(publishedResult.value)
  && publishedFingerprint.value === exportFingerprint.value);

watch(exportFingerprint, (value) => {
  if (publishedFingerprint.value && publishedFingerprint.value !== value) resetPublication();
});

onMounted(async () => {
  try {
    await registerPwa({
      serviceWorker: navigator.serviceWorker,
      windowObject: window,
      baseUrl: import.meta.env.BASE_URL,
      onUpdateReady(activateUpdate) {
        activatePwaUpdate = activateUpdate;
        pwaUpdateAvailable.value = true;
      },
    });
  } catch {
    pwaUpdateError.value = '離線啟動暫時無法準備；目前仍可在線使用與本機下載。';
  }
});

function applyPwaUpdate() {
  if (!activatePwaUpdate) return;
  pwaUpdateAvailable.value = false;
  activatePwaUpdate();
}

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
  resetPublication();
}

function toggleDate(localDate) {
  if (!selectedPreset.value) return;
  workspace.value.assignments = toggleAssignment(workspace.value.assignments, {
    calendarProfileId: currentProfile.value.id,
    presetId: selectedPreset.value.id,
    date: localDate,
  });
  downloadMessage.value = '';
  resetPublication();
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

function createCurrentExport() {
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
  return { result, generatedAt };
}

function recordCurrentExport(result, generatedAt) {
  workspace.value = recordExport(workspace.value, {
    id: crypto.randomUUID(),
    calendarProfileId: currentProfile.value.id,
    startDate: workspace.value.draft.exportStartDate,
    endDate: workspace.value.draft.exportEndDate,
    filename: result.filename,
    eventCount: result.events.length,
    createdAt: generatedAt.toISOString(),
  }, { today });
}

function triggerDownload(result) {
  const url = URL.createObjectURL(new Blob([result.ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function friendlyExportError(error) {
  return ({
    invalid_export_range: '請確認輸出開始日與結束日。',
    export_events_required: '這個範圍內還沒有 assignment。',
    assignment_preset_not_found: '有 assignment 對應不到常用項目，請重新選擇。',
  })[error.message] ?? error.message;
}

function resetPublication() {
  publicationCheckId += 1;
  publishError.value = '';
  publishMessage.value = '';
  publishedResult.value = null;
  publishedFingerprint.value = '';
  publishedIcs.value = '';
  publicationReady.value = false;
  publicationCheckBusy.value = false;
  publicationCheckError.value = '';
}

function downloadIcs() {
  exportError.value = '';
  downloadMessage.value = '';
  try {
    const { result, generatedAt } = createCurrentExport();
    triggerDownload(result);
    recordCurrentExport(result, generatedAt);
    downloadMessage.value = `已下載 ${result.filename}，共 ${result.events.length} 筆事件。`;
  } catch (error) {
    exportError.value = friendlyExportError(error);
  }
}

async function shareIcs() {
  exportError.value = '';
  downloadMessage.value = '';
  try {
    const { result, generatedAt } = createCurrentExport();
    const file = new File([result.ics], result.filename, { type: 'text/calendar;charset=utf-8' });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      try {
        await navigator.share({ title: result.filename, files: [file] });
        recordCurrentExport(result, generatedAt);
        downloadMessage.value = `已開啟分享選單：${result.filename}`;
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    triggerDownload(result);
    recordCurrentExport(result, generatedAt);
    downloadMessage.value = '這台裝置未完成檔案分享，已改為下載 .ics。';
  } catch (error) {
    exportError.value = friendlyExportError(error);
  }
}

function savePublisherCredential() {
  publisherCredentialError.value = '';
  try {
    publisherToken.value = publisherCredentialStorage.save(publisherTokenDraft.value);
    publisherTokenDraft.value = '';
  } catch {
    publisherCredentialError.value = '憑證格式不正確；請貼上管理者提供的完整裝置憑證。';
  }
}

function removePublisherCredential() {
  if (!window.confirm('確定移除這台裝置的發布憑證？排班草稿與已發布的 .ics 不受影響。')) return;
  publisherCredentialStorage.clear();
  publisherToken.value = '';
  publisherTokenDraft.value = '';
  publisherCredentialError.value = '';
  resetPublication();
}

function friendlyPublisherError(error) {
  return ({
    publisher_unauthorized: '發布憑證無效或已輪替，請重新設定。',
    publisher_rate_limited: '發布太頻繁，請稍候一分鐘再試。',
    publisher_write_conflict: '同一檔名正在被更新，請稍後再發布一次。',
    publisher_upstream_unauthorized: '發布服務暫時無法寫入 GitHub，請管理者檢查 server credential。',
    publisher_upstream_failed: 'GitHub 暫時無法完成發布，請稍後再試。',
    publisher_request_too_large: '這份 .ics 太大，請縮小輸出日期範圍。',
    publisher_response_invalid: '發布服務回應不完整，請先使用下載或分享。',
  })[error.message] ?? '發布失敗；排班草稿仍在這台裝置，可先下載或分享 .ics。';
}

async function publishIcs() {
  exportError.value = '';
  publishError.value = '';
  publishMessage.value = '';
  downloadMessage.value = '';
  if (!publisherConfigured.value) {
    publishError.value = publisherEndpointError || '發布服務尚未完成設定；目前可先下載或分享。';
    return;
  }
  if (!publisherCredentialConfigured.value) {
    publishError.value = '請先到「管理」設定這台裝置的發布憑證。';
    return;
  }
  publishBusy.value = true;
  try {
    const { result, generatedAt } = createCurrentExport();
    const publication = await publishIcsToServer({
      endpoint: publisherEndpoint,
      token: publisherToken.value,
      filename: result.filename,
      ics: result.ics,
    });
    recordCurrentExport(result, generatedAt);
    publishedResult.value = publication;
    publishedFingerprint.value = exportFingerprint.value;
    publishedIcs.value = result.ics;
    publishMessage.value = publication.operation === 'created'
      ? 'GitHub 已接收檔案，正在等待公開頁面就緒。'
      : 'GitHub 已更新檔案，正在確認公開連結不是舊版本。';
    void verifyPublishedIcs();
  } catch (error) {
    publishError.value = friendlyPublisherError(error);
  } finally {
    publishBusy.value = false;
  }
}

async function verifyPublishedIcs() {
  if (!publicationCurrent.value || !publishedIcs.value) return;
  const checkId = ++publicationCheckId;
  publicationReady.value = false;
  publicationCheckBusy.value = true;
  publicationCheckError.value = '';
  try {
    await waitForPublishedIcs({
      endpoint: publisherEndpoint,
      token: publisherToken.value,
      filename: publishedResult.value.filename,
      expectedIcs: publishedIcs.value,
    });
    if (checkId !== publicationCheckId) return;
    publicationReady.value = true;
    publishMessage.value = '公開檔已就緒，可以在 Safari 開啟並匯入。';
  } catch {
    if (checkId !== publicationCheckId) return;
    publicationCheckError.value = 'GitHub Pages 尚未顯示這次內容；可稍後再檢查，或先下載／分享 .ics。';
  } finally {
    if (checkId === publicationCheckId) publicationCheckBusy.value = false;
  }
}

async function copyPublicUrl() {
  if (!publicationCurrent.value) return;
  try {
    await navigator.clipboard.writeText(publishedResult.value.publicUrl);
    publishMessage.value = '公開連結已複製。';
  } catch {
    const field = document.createElement('textarea');
    field.value = publishedResult.value.publicUrl;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    publishMessage.value = copied ? '公開連結已複製。' : '無法自動複製，請長按下方連結。';
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
  resetPublication();
}
</script>

<template>
  <main class="app-shell">
    <aside v-if="pwaUpdateAvailable" class="update-banner" role="status">
      <span>LightCal 有新版本，草稿會保留在這台裝置。</span>
      <button type="button" @click="applyPwaUpdate">重新載入更新</button>
    </aside>
    <p v-if="pwaUpdateError" class="error-message pwa-error" role="status">{{ pwaUpdateError }}</p>
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

      <div class="settings-block publisher-credential-block">
        <div class="settings-title-row">
          <h3>這台裝置的發布憑證</h3>
          <span :class="publisherCredentialConfigured ? 'credential-ready' : 'credential-missing'">
            {{ publisherCredentialConfigured ? '已設定' : '未設定' }}
          </span>
        </div>
        <p class="credential-copy">憑證只保存在這個 PWA 的本機 storage，不會放進 .ics 或 GitHub。移除後仍可下載與分享。</p>
        <form v-if="!publisherCredentialConfigured" class="credential-form" @submit.prevent="savePublisherCredential">
          <input class="visually-hidden" type="text" name="username" value="lightcal-publisher" autocomplete="username" tabindex="-1" aria-hidden="true">
          <label class="grow-field">裝置憑證
            <input
              v-model="publisherTokenDraft"
              type="password"
              minlength="43"
              maxlength="128"
              autocomplete="new-password"
              autocapitalize="none"
              spellcheck="false"
              placeholder="貼上管理者提供的憑證"
            >
          </label>
          <button class="secondary-button" type="submit">儲存到這台裝置</button>
        </form>
        <button v-else class="danger-button remove-credential-button" type="button" @click="removePublisherCredential">移除發布憑證</button>
        <p v-if="publisherCredentialError" class="error-message">{{ publisherCredentialError }}</p>
        <p v-if="publisherEndpointError" class="error-message">{{ publisherEndpointError }}</p>
        <p v-else-if="!publisherConfigured" class="empty-copy">正式 publisher endpoint 尚未寫入 build；目前仍可離線排班與產檔。</p>
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
        <div><span class="step-number">3</span><h2 id="export-heading">確認範圍並發布</h2></div>
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
      <p v-if="overlapRecords.length" class="overlap-warning">這個日期範圍與 {{ overlapRecords.length }} 次先前輸出重疊。Apple 不保證重複匯入會自動去重，請確認後再發布或下載。</p>
      <p v-if="exportError" class="error-message">{{ exportError }}</p>
      <p v-if="publishError" class="error-message">{{ publishError }}</p>
      <p v-if="publishMessage" class="success-message">{{ publishMessage }}</p>
      <p v-if="publicationCheckError" class="overlap-warning">{{ publicationCheckError }}</p>
      <p v-if="downloadMessage" class="success-message">{{ downloadMessage }}</p>
      <button
        class="primary-button publish-button"
        type="button"
        :disabled="!exportRangeValid || !exportAssignments.length || publishBusy"
        @click="publishIcs"
      >
        {{ publishBusy ? '正在安全發布…' : '發布並取得公開連結' }}
      </button>
      <button v-if="!publisherCredentialConfigured" class="credential-shortcut" type="button" @click="openManagement">先設定這台裝置的發布憑證</button>

      <div v-if="publicationCurrent" class="published-card" aria-live="polite">
        <span class="section-label">公開連結 · {{ publicationReady ? '已就緒' : publicationCheckBusy ? '檢查中' : '待確認' }}</span>
        <a class="public-url" :href="publishedResult.publicUrl" target="_blank" rel="noopener noreferrer">{{ publishedResult.publicUrl }}</a>
        <a v-if="publicationReady" class="safari-button" :href="publishedResult.publicUrl" target="_blank" rel="noopener noreferrer">在 Safari 開啟並匯入</a>
        <button v-else class="safari-button safari-button-pending" type="button" disabled>{{ publicationCheckBusy ? '等待 GitHub Pages…' : '公開檔尚未就緒' }}</button>
        <button class="secondary-button" type="button" @click="copyPublicUrl">複製公開連結</button>
        <button v-if="publicationCheckError" class="secondary-button retry-publication-button" type="button" @click="verifyPublishedIcs">再檢查一次</button>
      </div>

      <div class="fallback-actions">
        <button class="secondary-button" type="button" :disabled="!exportRangeValid || !exportAssignments.length" @click="downloadIcs">下載 .ics</button>
        <button class="secondary-button" type="button" :disabled="!exportRangeValid || !exportAssignments.length" @click="shareIcs">分享 .ics</button>
      </div>
      <p class="apple-boundary">公開連結由 Safari 開啟後，再由你選擇要匯入的 Apple Calendar；本工具不會讀回、覆寫或同步已匯入事件。</p>
    </section>
  </main>
</template>
