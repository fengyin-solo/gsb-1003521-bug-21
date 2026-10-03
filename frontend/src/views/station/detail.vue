<template>
  <section class="page" data-module="station-detail">
    <header class="page-head">
      <div>
        <h2>站点详情</h2>
        <p class="page-desc">站点状态与归属到该站点的全部监测记录取数一致：站点撤销后仅可补录停用前的历史观测。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/station">返回监测站点列表</RouterLink>
      </div>
    </header>

    <template v-if="detail">
      <article class="detail-card">
        <h3>{{ detail.station['站点名称'] }}（{{ detail.station['站点编号'] }}）</h3>
        <dl class="detail-grid">
          <template v-for="field in meta.fields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detail.station[field] === '' ? '—' : (detail.station[field] ?? '—') }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd :class="{ 'status-abnormal': detail.station.abnormal }">{{ detail.station.status }}</dd>
        </dl>
      </article>

      <div class="stat-row">
        <article v-for="item in detail.totals" :key="item.name" class="stat-card">
          <span class="stat-label">{{ item.name }}</span>
          <strong class="stat-value">{{ item.count }}</strong>
        </article>
      </div>

      <section v-for="group in detail.related" :key="group.key" class="related-block">
        <h4>
          {{ group.name }}
          <span class="related-count">归属 {{ group.items.length }} 条</span>
        </h4>
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in relatedColumns(group.key)" :key="column">{{ column }}</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in group.items" :key="`${group.key}-${item.id}`">
              <td v-for="column in relatedColumns(group.key)" :key="column">{{ item[column] ?? '—' }}</td>
              <td>{{ item.status }}</td>
            </tr>
            <tr v-if="!group.items.length">
              <td :colspan="relatedColumns(group.key).length + 1" class="empty-state">该站点暂无{{ group.name }}记录</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <section v-else class="detail-card">
      <p class="error-text">没有找到该监测站点，可能已被重置。</p>
    </section>

    <footer class="page-foot">
      <RouterLink class="link" to="/station">← 返回监测站点列表</RouterLink>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getStationDetail, moduleMeta } from '@/api/local-service'
import { subscribe } from '@/data/local-store'
import type { StationDetail } from '@/data/types'

const route = useRoute()
const meta = moduleMeta('station')
const errorMessage = ref('')
const detail = ref<StationDetail>()

// 详情页只展示能帮助核对归属的关键列：站点编号列 + 时间/状态类列，避免横向铺 8 列。
const RELATED_COLUMNS: Record<string, string[]> = {
  waterlevel: ['记录编号', '观测时间', '当前水位'],
  discharge: ['记录编号', '测量时间', '断面流量'],
  rainfall: ['记录编号', '观测时段', '时段雨量'],
  waterquality: ['报告编号', '采样时间', '检测项目'],
  crosssection: ['记录编号', '测量日期', '断面名称'],
  telemetry: ['设备编号', '设备类型', '最近维护日'],
  compilation: ['成果编号', '整编年份', '整编类型'],
  warning: ['配置编号', '监测类型'],
  evaporation: ['记录编号', '观测日期', '蒸发量'],
  cableway: ['缆道编号', '跨度米数', '最近检修日'],
  sediment: ['记录编号', '采样时间', '含沙量'],
  communication: ['设备编号', '设备类型', '最近通讯时刻'],
  stationhouse: ['记录编号', '维护类型', '维护日期'],
  inspection: ['记录编号', '巡检日期', '巡检人员'],
}

function relatedColumns(key: string): string[] {
  return RELATED_COLUMNS[key] ?? ['记录编号']
}

function reload() {
  errorMessage.value = ''
  try {
    detail.value = getStationDetail(Number(route.params.id))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '站点详情读取失败'
  }
}

let unsubscribe: (() => void) | undefined

onMounted(() => {
  reload()
  // 列表页撤销站点 / 记录页提交失败回退时，详情同步重读，三处口径不打架
  unsubscribe = subscribe(() => reload())
})

onUnmounted(() => unsubscribe?.())
</script>

<style scoped>
.detail-card {
  background: #fff;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(4, 92px 1fr);
  gap: 6px 12px;
  margin: 12px 0 0;
}

.detail-grid dt {
  color: #667085;
  font-size: 13px;
}

.detail-grid dd {
  margin: 0;
  font-size: 13px;
}

.status-abnormal {
  color: #b42318;
  font-weight: 600;
}

.related-block {
  margin-bottom: 20px;
}

.related-block h4 {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 8px;
}

.related-count {
  font-size: 12px;
  font-weight: 400;
  color: #667085;
}
</style>
