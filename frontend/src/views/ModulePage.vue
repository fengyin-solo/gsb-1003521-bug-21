<template>
  <section class="page" :data-module="page.meta.key">
    <header class="page-head">
      <div>
        <h2>{{ page.meta.name }}管理</h2>
        <p class="page-desc">{{ page.meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="page.openCreate()">
          登记{{ page.meta.entity }}
        </button>
        <button class="btn" type="button" @click="page.exportRows()">
          导出{{ page.meta.name }}清单
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in page.stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in page.statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="page.reload()">
      <label v-for="field in page.filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="page.filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="page.resetFilters()">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in page.columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th v-if="isStation">站点详情</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in page.rows" :key="String(row.id)">
          <td v-for="column in page.columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span :class="{ 'status-abnormal': row.abnormal, 'status-done': !row.pending && !row.abnormal }">
              {{ row.status }}
            </span>
          </td>
          <td v-if="isStation">
            <RouterLink class="link" :to="`/station/${row.id}`">查看</RouterLink>
          </td>
          <td class="row-actions">
            <template v-if="page.actionsFor(row).length">
              <button
                v-for="action in page.actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="page.runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">无可用动作</span>
          </td>
        </tr>
        <tr v-if="!page.rows.length">
          <td :colspan="page.columns.length + (isStation ? 3 : 2)" class="empty-state">
            暂无{{ page.meta.name }}数据，可先登记{{ page.meta.entity }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ page.total }} 条{{ page.meta.entity }}记录</span>
      <span v-if="page.errorMessage" class="error-text">{{ page.errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { useModulePage } from './useModulePage'

const props = defineProps<{ moduleKey: string }>()
const page = useModulePage(props.moduleKey)
const isStation = props.moduleKey === 'station'
</script>

<style scoped>
.status-abnormal { color: #b42318; font-weight: 600; }
.status-done { color: #027a48; }
.muted-text { color: var(--muted); font-size: 12px; }
</style>
