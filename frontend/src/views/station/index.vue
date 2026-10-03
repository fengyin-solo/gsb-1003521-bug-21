<template>
  <section class="page" data-module="station">
    <header class="page-head">
      <div>
        <h2>监测站点管理</h2>
        <p class="page-desc">维护水文监测站，围绕站点编号、站点名称、站点类型、所在河流做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水文监测站</button>
        <button class="btn" type="button" @click="exportRows">导出监测站点清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <RouterLink
              v-if="column === codeField"
              class="link"
              :to="`/station/${row.id}`"
            >{{ row[column] ?? '—' }}</RouterLink>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!actionAllowed(row, action)"
              :title="actionAllowed(row, action) ? '' : guardHint(action)"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无监测站点数据，可先登记水文监测站</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条监测站点记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  computeStats,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { subscribe } from '@/data/local-store'
import {
  STATION_ACTION_GUARDS,
  STATION_CODE_FIELD,
} from '@/data/domain'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('station')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses
const codeField = STATION_CODE_FIELD
const stats = computed(() =>
  computeStats(meta).map((value, index) => ({ label: meta.metricSpecs[index].label, value })),
)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 与服务层 STATION_ACTION_GUARDS 同一口径：不满足起始状态的动作直接置灰，提交时仍会再校验一次。
function actionAllowed(row: EntryRow, action: string): boolean {
  const guard = STATION_ACTION_GUARDS[action]
  return guard ? guard.from.includes(String(row.status)) : true
}

function guardHint(action: string): string {
  return STATION_ACTION_GUARDS[action]?.blocked ?? '当前状态不可执行该动作'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水文监测站登记入口尚未接入审批流'
}

async function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  try {
    const result = await applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  } catch (error) {
    // 持久化失败时数据层已整体回滚：重读列表，保持与站点详情、运营概览一致
    errorMessage.value = error instanceof Error ? error.message : '操作失败，已回退到操作前状态'
    reload()
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '监测站点列表读取失败'
  }
}

let unsubscribe: (() => void) | undefined

onMounted(() => {
  reload()
  // 撤销/提交并发落盘或异常回退后，列表随数据版本自动重读
  unsubscribe = subscribe(() => reload())
})

onUnmounted(() => unsubscribe?.())
</script>
