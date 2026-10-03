<template>
  <section class="page" data-module="station-detail">
    <header class="page-head">
      <div>
        <h2>站点详情</h2>
        <p class="page-desc">站点信息与各监测模块的关联记录按同一个站点编号聚合取数。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/station">返回监测站点列表</RouterLink>
      </div>
    </header>

    <div v-if="!detail" class="empty-state">没有找到该站点，可能已被重置。<RouterLink class="link" to="/station">返回列表</RouterLink></div>

    <template v-else>
      <article class="detail-card">
        <h3 class="detail-title">
          {{ detail.station['站点名称'] }}
          <span :class="['status-tag', tagClass(detail.station.status)]">{{ detail.station.status }}</span>
        </h3>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detail.station[field] || '—' }}</dd>
          </template>
        </dl>
      </article>

      <h3 class="section-title">关联监测记录</h3>
      <table v-for="group in nonEmptyGroups" :key="group.key" class="data-table group-table">
        <thead>
          <tr>
            <th>{{ group.name }}</th>
            <th v-for="column in groupColumns(group.key)" :key="column">{{ column }}</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in group.items" :key="`${group.key}-${item.id}`">
            <td>{{ item.id }}</td>
            <td v-for="column in groupColumns(group.key)" :key="column">{{ item[column] ?? '—' }}</td>
            <td>
              <span :class="{ 'status-abnormal': item.abnormal }">{{ item.status }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!nonEmptyGroups.length" class="empty-state">该站点暂无关联监测记录。</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { loadStationDetail, subscribe } from '@/api/local-service'
import type { StationDetail } from '@/api/local-service'
import { MODULE_BY_KEY } from '@/data/modules'

const route = useRoute()
const detail = ref<StationDetail | null>(null)

const detailFields = ['站点编号', '站点类型', '所在河流', '经纬度坐标', '建站年份', '管理单位', '撤销时间']

function tagClass(status: string): string {
  if (status === '正常运行' || status === '汛期加强') {
    return 'tag-ok'
  }
  if (status === '已撤销') {
    return 'tag-off'
  }
  return 'tag-bad'
}

function groupColumns(key: string): string[] {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return []
  }
  // 站点归属列与详情页同口径，列表里重复展示无意义，这里去掉。
  return meta.fields.filter((field) => field !== meta.stationRef)
}

const nonEmptyGroups = computed(() => detail.value?.groups.filter((g) => g.items.length > 0) ?? [])

function reload() {
  const id = Number(route.params.id)
  detail.value = Number.isNaN(id) ? null : loadStationDetail(id)
}

let unsubscribe: (() => void) | undefined
onMounted(() => {
  reload()
  // 站点撤销或记录提交后，详情页与列表、概览一起重读，状态口径始终一致。
  unsubscribe = subscribe(reload)
})
onUnmounted(() => {
  unsubscribe?.()
})
</script>

<style scoped>
.detail-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; }
.detail-title { margin: 0 0 12px; font-size: 16px; display: flex; align-items: center; gap: 10px; }
.detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 16px; margin: 0; }
.detail-grid dt { color: var(--muted); font-size: 12px; }
.detail-grid dd { margin: 0 0 6px; font-size: 13px; }
.section-title { font-size: 14px; margin: 18px 0 8px; }
.group-table { margin-bottom: 14px; }
.status-abnormal { color: #b42318; font-weight: 600; }
.status-tag { font-size: 12px; border-radius: 999px; padding: 2px 10px; font-weight: 500; }
.tag-ok { background: #e7f6ee; color: #027a48; }
.tag-bad { background: #fef0ee; color: #b42318; }
.tag-off { background: #eef2f7; color: #64748b; }
</style>
