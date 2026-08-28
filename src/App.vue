<script setup>
import { computed } from 'vue';
import { generateIcs } from './domain/ics.js';
import { G0_CALENDAR_NAME, G0_EVENTS, G0_GENERATED_AT, G0_OUTPUT_NAME } from './fixtures/g0.js';

const ics = computed(() => generateIcs(G0_EVENTS, {
  calendarName: G0_CALENDAR_NAME,
  generatedAt: G0_GENERATED_AT,
}));
const fixtureUrl = `${import.meta.env.BASE_URL}${G0_OUTPUT_NAME}`;

function downloadFixture() {
  const url = URL.createObjectURL(new Blob([ics.value], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = G0_OUTPUT_NAME;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function rangeLabel(event) {
  return `${event.startLocal.replace('T', ' ')} → ${event.endLocal.replace('T', ' ')}`;
}
</script>

<template>
  <main class="page">
    <section class="hero">
      <p class="eyebrow">LightCal ICS · G0</p>
      <h1>Apple Calendar 三事件匯入測試</h1>
      <p class="lead">只產生本機測試檔，不會連線或修改 Apple Calendar。請匯入專用測試行事曆。</p>
      <button type="button" @click="downloadFixture">下載三事件測試檔</button>
      <a class="secondary" :href="fixtureUrl" download>下載預先產生版本</a>
    </section>

    <section class="event-list" aria-label="測試事件摘要">
      <article v-for="event in G0_EVENTS" :key="event.id" class="event-card">
        <div>
          <h2>{{ event.title }}</h2>
          <p>{{ rangeLabel(event) }} · Asia/Taipei</p>
        </div>
        <span v-if="event.reminderMinutesBefore" class="badge">提前 {{ event.reminderMinutesBefore }} 分鐘提醒</span>
      </article>
    </section>

    <p class="warning">此檔只供 G0 驗證。重複匯入可能產生重複事件，請勿匯入正式「班表」行事曆。</p>
  </main>
</template>
