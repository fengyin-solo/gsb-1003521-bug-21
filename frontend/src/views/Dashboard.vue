<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，状态口径与监测站点列表、站点详情完全一致。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">监测站点运行状态</h3>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">站点总数</span>
        <strong class="stat-value">{{ station.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">正常运行（含汛期加强）</span>
        <strong class="stat-value ok">{{ station.normal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">设备故障</span>
        <strong class="stat-value bad">{{ station.fault }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">暂停运行</span>
        <strong class="stat-value warn">{{ station.suspended }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已撤销</span>
        <strong class="stat-value muted">{{ station.revoked }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td :class="{ 'cell-bad': row.abnormal > 0 }">{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { loadOverview, subscribe } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const station = ref<OverviewResult['station']>({
  total: 0,
  normal: 0,
  fault: 0,
  suspended: 0,
  revoked: 0,
})
const moduleRows = ref<OverviewResult['modules']>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  station.value = payload.station
  moduleRows.value = payload.modules
}

let unsubscribe: (() => void) | undefined
onMounted(() => {
  refresh()
  // 撤销站点或提交记录后，运营概览与列表、详情一起刷新，失败则整体停留在旧结果。
  unsubscribe = subscribe(refresh)
})
onUnmounted(() => {
  unsubscribe?.()
})
</script>

<style scoped>
.section-title { font-size: 14px; margin: 18px 0 8px; }
.ok { color: #027a48; }
.bad { color: #b42318; }
.warn { color: #b54708; }
.muted { color: var(--muted); }
.cell-bad { color: #b42318; font-weight: 600; }
</style>
