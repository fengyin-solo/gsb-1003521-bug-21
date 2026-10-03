import { allRows, listRows, mutate, resetRows, subscribe } from '@/data/local-store'
import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import {
  abnormalStatusesOf,
  isTerminal,
  pendingStatusesOf,
  projectRow,
} from '@/data/status'
import { checkStationForSubmit, STATION_MODULE, STATION_REVOKED_AT_FIELD } from '@/data/station'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  StationSummary,
} from '@/data/types'

export { subscribe }

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const meta = moduleMeta(key)
  // 出参统一过状态口径投影，确保列表拿到的 status/pending/abnormal 与状态镜像字段一致。
  const projected = listRows(key).map((row) => projectRow(meta, row))
  const matched = filterRows(projected, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// 串行队列：并发的撤销与提交动作只会排队执行，后一个看到前一个的结果，二者不可能同时落库。
let tail: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => T): Promise<T> {
  const run = tail.then(() => job())
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function runAction(key: string, id: number, action: string): Promise<ActionResult> {
  return enqueue(() => {
    const meta = moduleMeta(key)
    const target = meta.actionTargets[action]
    if (!target) {
      return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
    }
    try {
      let outcome: ActionResult = { ok: true, message: '' }
      mutate((draft) => {
        const rows = draft[key] ?? []
        const index = rows.findIndex((row) => Number(row.id) === id)
        if (index < 0) {
          outcome = { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
          return
        }
        const row = rows[index]
        const current = String(row.status)
        if (current === target) {
          outcome = { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
          return
        }
        if (isTerminal(meta, current)) {
          outcome = {
            ok: false,
            message: `${meta.entity}已处于终态「${current}」，不能再执行「${action}」`,
          }
          return
        }
        // 提交类动作统一做站点归属与运行状态校验：站点不存在/已撤销一律拒绝，且全程不落任何数据。
        if (key !== STATION_MODULE && meta.stationRef && meta.submitActions?.includes(action)) {
          const stationCode = String(row[meta.stationRef] ?? '')
          const observedAt = meta.dateField ? String(row[meta.dateField] ?? '') : undefined
          const reason = checkStationForSubmit(stationCode, observedAt, draft[STATION_MODULE] ?? [])
          if (reason) {
            outcome = { ok: false, message: reason }
            return
          }
        }
        const updated: EntryRow = { ...row, status: target }
        if (key === STATION_MODULE && target === '已撤销') {
          if (String(updated[STATION_REVOKED_AT_FIELD] ?? '').trim() === '') {
            updated[STATION_REVOKED_AT_FIELD] = today()
          }
        }
        rows[index] = projectRow(meta, updated)
        draft[key] = rows
        outcome = { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
      })
      return outcome
    } catch (error) {
      // 事务已在 local-store 回滚到提交前快照：列表、详情、运营概览重读即整体回退。
      return {
        ok: false,
        message: error instanceof Error ? `操作失败已回滚：${error.message}` : '操作失败，数据已回滚',
      }
    }
  })
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 列表统计卡：口径同样来自模块状态集合，不再在页面里各写一套。
export function moduleCounts(key: string): { total: number; pending: number; abnormal: number } {
  const meta = moduleMeta(key)
  const entries = listRows(meta.key)
  return {
    total: entries.length,
    pending: entries.filter((row) => pendingStatusesOf(meta).has(String(row.status))).length,
    abnormal: entries.filter((row) => abnormalStatusesOf(meta).has(String(row.status))).length,
  }
}

function stationSummary(stations: EntryRow[]): StationSummary {
  return {
    total: stations.length,
    normal: stations.filter((row) => row.status === '正常运行').length,
    fault: stations.filter((row) => row.status === '设备故障').length,
    suspended: stations.filter((row) => row.status === '暂停运行').length,
    revoked: stations.filter((row) => row.status === '已撤销').length,
  }
}

export type StationDetailGroup = {
  key: string
  name: string
  refField: string
  items: EntryRow[]
}

export type StationDetail = {
  station: EntryRow
  groups: StationDetailGroup[]
}

/** 站点详情：站点信息与各监测模块的关联记录都在这里按同一个站点编号聚合取数。 */
export function loadStationDetail(id: number): StationDetail | null {
  const stations = listRows(STATION_MODULE)
  const station = stations.find((row) => Number(row.id) === id)
  if (!station) {
    return null
  }
  const code = String(station['站点编号'] ?? '').trim()
  const groups: StationDetailGroup[] = []
  for (const meta of MODULES) {
    if (meta.key === STATION_MODULE || !meta.stationRef) {
      continue
    }
    const items = listRows(meta.key)
      .filter((row) => String(row[meta.stationRef as string] ?? '').trim() === code)
      .map((row) => projectRow(meta, row))
    groups.push({ key: meta.key, name: meta.name, refField: meta.stationRef, items })
  }
  return { station: projectRow(moduleMeta(STATION_MODULE), station), groups }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => pendingStatusesOf(meta).has(String(row.status))).length,
      abnormal: entries.filter((row) => abnormalStatusesOf(meta).has(String(row.status))).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, station: stationSummary(rows[STATION_MODULE] ?? []), modules }
}
