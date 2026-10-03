<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常；站点状态与监测站点列表、站点详情同源。</p>
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
    <p class="status-legend">
      <RouterLink
        v-for="item in stationStatuses"
        :key="item.status"
        class="legend-item legend-link"
        to="/station"
      >
        {{ item.status }}：{{ item.count }}
      </RouterLink>
    </p>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td :class="{ 'error-text': row.abnormal > 0 }">{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；动作失败时全部页面一起回退。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { subscribe } from '@/data/local-store'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const stationStatuses = ref<OverviewResult['stationStatuses']>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  stationStatuses.value = payload.stationStatuses
}

let unsubscribe: (() => void) | undefined

onMounted(() => {
  refresh()
  // 任意页面撤销站点/提交记录/回退后，概览随数据版本重新统计
  unsubscribe = subscribe(() => refresh())
})

onUnmounted(() => unsubscribe?.())
</script>

<style scoped>
.section-title {
  margin: 8px 0 4px;
  font-size: 15px;
}

.legend-link {
  text-decoration: none;
}
</style>
