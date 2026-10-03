import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleCounts,
  moduleMeta,
  runAction as applyAction,
  subscribe,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { isTerminal } from '@/data/status'

// 所有业务模块列表页共用一套取数/动作/统计逻辑：
// 页面只传模块 key，列、动作、状态、统计口径全部来自模块元数据，避免 18 个页面各写一套。
export function useModulePage(moduleKey: string) {
  const meta = moduleMeta(moduleKey)
  const columns = meta.fields
  const actions = meta.actions
  const statuses = meta.statuses

  const rows = ref<EntryRow[]>([])
  const total = ref(0)
  const errorMessage = ref('')
  const filters = ref<Record<string, string>>({})
  const filterFields = columns.slice(0, 3)

  const stats = computed(() => {
    if (moduleKey === 'station') {
      const normal = rows.value.filter((r) => r.status === '正常运行').length
      const fault = rows.value.filter((r) => r.status === '设备故障').length
      const suspended = rows.value.filter((r) => r.status === '暂停运行').length
      const revoked = rows.value.filter((r) => r.status === '已撤销').length
      return [
        { label: '站点总数', value: rows.value.length },
        { label: '正常运行', value: normal },
        { label: '设备故障', value: fault },
        { label: '暂停运行', value: suspended },
        { label: '已撤销', value: revoked },
      ]
    }
    const counts = moduleCounts(moduleKey)
    return [
      { label: '记录总数', value: counts.total },
      { label: '待处理', value: counts.pending },
      { label: '异常量', value: counts.abnormal },
    ]
  })

  const statusSummary = computed(() =>
    statuses.map((status: string) => ({
      status,
      count: rows.value.filter((row) => String(row.status) === status).length,
    })),
  )

  function reload() {
    errorMessage.value = ''
    try {
      const payload = listEntries(meta.key, filters.value)
      rows.value = payload.items
      total.value = payload.total
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : `${meta.name}列表读取失败`
    }
  }

  function resetFilters() {
    filters.value = {}
    reload()
  }

  function exportRows() {
    downloadEntries(meta.key)
  }

  function openCreate() {
    errorMessage.value = `${meta.entity}登记入口尚未接入审批流`
  }

  // 终态行（如已撤销站点）不再给出任何动作入口。
  function actionsFor(row: EntryRow): string[] {
    return isTerminal(meta, String(row.status)) ? [] : actions
  }

  async function runAction(action: string, row: EntryRow) {
    errorMessage.value = ''
    const result = await applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      // 失败不改任何数据；没有落库就不会通知订阅，列表/详情/概览都停留在提交前状态。
      errorMessage.value = result.message
    }
    // 成功时由 store 订阅统一触发 reload，撤销/提交后各页面一起刷新到同一结果。
  }

  let unsubscribe: (() => void) | undefined
  onMounted(() => {
    reload()
    unsubscribe = subscribe(reload)
  })
  onUnmounted(() => {
    unsubscribe?.()
  })

  return reactive({
    meta,
    columns,
    rows,
    total,
    errorMessage,
    filters,
    filterFields,
    stats,
    statusSummary,
    reload,
    resetFilters,
    exportRows,
    openCreate,
    runAction,
    actionsFor,
  })
}
