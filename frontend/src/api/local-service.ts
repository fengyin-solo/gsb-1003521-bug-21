import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import {
  allRows,
  getRevision,
  listRows,
  mutateRows,
  resetRows,
} from '@/data/local-store'
import {
  INACTIVE_STATION_STATUSES,
  isAbnormalStatus,
  isActiveStation,
  isPendingStatus,
  STATION_ACTION_GUARDS,
  STATION_CODE_FIELD,
  STATION_INACTIVE_SINCE_FIELD,
  STATION_RUNNING_FIELD,
  STATION_STATUS,
} from '@/data/domain'
import type {
  ActionResult,
  EntryRow,
  MetricSpec,
  ModuleMeta,
  OverviewResult,
  PageResult,
  StationDetail,
} from '@/data/types'

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
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === Number(id))
}

/** 指标卡取数：total/pending/abnormal/status 四种口径都来自模块状态集合，列表与运营概览完全一致。 */
export function computeStats(meta: ModuleMeta, rows: EntryRow[] = listRows(meta.key)): number[] {
  const countBy = (predicate: (row: EntryRow) => boolean) => rows.filter(predicate).length
  return meta.metricSpecs.map((spec) => {
    if (spec.kind === 'total') {
      return rows.length
    }
    if (spec.kind === 'pending') {
      return countBy((row) => isPendingStatus(meta, String(row.status)))
    }
    if (spec.kind === 'abnormal') {
      return countBy((row) => isAbnormalStatus(meta, String(row.status)))
    }
    return countBy((row) => String(row.status) === spec.status)
  })
}

function stationIndex(rows: Record<string, EntryRow[]>): Map<string, EntryRow> {
  const map = new Map<string, EntryRow>()
  for (const station of rows.station ?? []) {
    map.set(String(station[STATION_CODE_FIELD] ?? '').trim(), station)
  }
  return map
}

/**
 * 站点详情：站点本体 + 所有声明了归属字段的模块在该站点下的记录。
 * 站点动作影响哪些监测数据、各记录从哪里取数，都汇聚在这一条链路上。
 */
export function getStationDetail(id: number): StationDetail | undefined {
  const all = allRows()
  const station = (all.station ?? []).find((row) => Number(row.id) === Number(id))
  if (!station) {
    return undefined
  }
  const code = String(station[STATION_CODE_FIELD] ?? '').trim()
  const related = MODULES.filter((meta) => meta.stationField && meta.key !== 'station').map((meta) => {
    const stationField = meta.stationField as string
    const items = (all[meta.key] ?? []).filter(
      (row) => String(row[stationField] ?? '').trim() === code,
    )
    return { key: meta.key, name: meta.name, stationField, items }
  })
  const totals = related.map((group) => ({ name: group.name, count: group.items.length }))
  return { station, related, totals }
}

function findStationByCode(rows: Record<string, EntryRow[]>, code: string): EntryRow | undefined {
  return stationIndex(rows).get(String(code ?? '').trim())
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 记录动作前的站点归属与运行期校验。
 * - 「提交」类动作：站点必须存在；撤销/暂停站只允许补录停用时间之前的历史观测，之后禁止。
 * - 非提交动作（审核、通过、标记异常等）：是对已有记录的处理，撤销后历史记录仍允许处置。
 */
function validateRecordOwnership(
  meta: ModuleMeta,
  row: EntryRow,
  action: string,
  draft: Record<string, EntryRow[]>,
): string | null {
  if (!meta.stationField) {
    return null
  }
  const code = String(row[meta.stationField] ?? '').trim()
  if (!code) {
    return `${meta.entity}缺少${meta.stationField}，无法归属到监测站点`
  }
  const station = findStationByCode(draft, code)
  if (!station) {
    return `${meta.stationField}「${code}」在监测站点列表中不存在，请先核对站点编号`
  }

  const submitActions = meta.submitActions ?? []
  if (!submitActions.includes(action)) {
    return null
  }

  const stationStatus = String(station.status)
  if (isActiveStation(stationStatus)) {
    return null
  }
  if (!INACTIVE_STATION_STATUSES.includes(stationStatus)) {
    return `站点「${code}」状态为「${stationStatus}」，不能承接新的${meta.entity}`
  }

  const verb = stationStatus === STATION_STATUS.revoked ? '撤销' : '暂停'
  if (!meta.timeField) {
    return `站点「${code}」已${verb}，不能再提交${meta.entity}`
  }
  const observedAt = String(row[meta.timeField] ?? '').slice(0, 10)
  const since =
    String(station[STATION_INACTIVE_SINCE_FIELD] ?? '').trim().slice(0, 10) || todayText()
  if (!observedAt) {
    return `${meta.entity}缺少${meta.timeField}，无法判断是否为站点${verb}前的历史观测`
  }
  if (observedAt >= since) {
    return `站点「${code}」已于${since}${verb}，${meta.timeField}为 ${observedAt} 的${meta.entity}不能提交；仅允许补录${verb}前的历史观测`
  }
  return null
}

function validateStationAction(row: EntryRow, action: string): string | null {
  const guard = STATION_ACTION_GUARDS[action]
  if (!guard) {
    return null
  }
  if (!guard.from.includes(String(row.status))) {
    return `${guard.blocked}（当前状态「${row.status}」）`
  }
  return null
}

/**
 * 动作队列：所有「撤销站点 / 提交记录」串行执行。
 * 并发点两下时，后一个动作一定在前一个动作提交后的新快照上校验——
 * 站点已撤销则提交被拒，站点已承接提交则重复撤销被拒，只有一个结果落盘。
 */
let actionQueue: Promise<ActionResult> = Promise.resolve({ ok: true, message: '' })

export function runAction(key: string, id: number, action: string): Promise<ActionResult> {
  actionQueue = actionQueue.then(() => executeAction(key, id, action))
  return actionQueue
}

function executeAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }

  let result: ActionResult = { ok: false, message: '' }
  const outcome = mutateRows((draft) => {
    const rows = draft[meta.key]
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      result = { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
      return { value: result, commit: false }
    }
    const current = rows[index]
    if (String(current.status) === target) {
      result = { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
      return { value: result, commit: false }
    }

    const blocking =
      meta.key === 'station'
        ? validateStationAction(current, action)
        : validateRecordOwnership(meta, current, action, draft)
    if (blocking) {
      result = { ok: false, message: blocking }
      return { value: result, commit: false }
    }

    const updated: EntryRow = {
      ...current,
      status: target,
      pending: isPendingStatus(meta, target),
      abnormal: isAbnormalStatus(meta, target),
    }
    if (meta.key === 'station') {
      // 站点表「运行状态」与状态主字段同源，撤销/暂停同时写入停用时间。
      updated[STATION_RUNNING_FIELD] = target
      const inactive = INACTIVE_STATION_STATUSES.includes(target)
      if (inactive && String(updated[STATION_INACTIVE_SINCE_FIELD] ?? '').trim() === '') {
        updated[STATION_INACTIVE_SINCE_FIELD] = todayText()
      }
      if (!inactive) {
        updated[STATION_INACTIVE_SINCE_FIELD] = ''
      }
    }
    rows[index] = updated
    result = { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
    return { value: result, commit: true }
  })

  return outcome.value
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
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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

export function stationStatusSummary(): { status: string; count: number }[] {
  const meta = moduleMeta('station')
  const rows = listRows('station')
  return meta.statuses.map((status) => ({
    status,
    count: rows.filter((row) => String(row.status) === status).length,
  }))
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => isPendingStatus(meta, String(row.status))).length,
      abnormal: entries.filter((row) => isAbnormalStatus(meta, String(row.status))).length,
    }
  })
  const stationMeta = MODULE_BY_KEY.get('station') as ModuleMeta
  const stationRows = rows.station ?? []
  const stationStatuses = stationMeta.statuses.map((status) => ({
    status,
    count: stationRows.filter((row) => String(row.status) === status).length,
  }))
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    {
      label: '正常运行站点',
      value: stationRows.filter((row) => String(row.status) === STATION_STATUS.normal).length,
    },
    {
      label: '故障/异常量',
      value:
        stationRows.filter((row) => String(row.status) === STATION_STATUS.fault).length +
        modules
          .filter((item) => item.name !== '监测站点')
          .reduce((sum, item) => sum + item.abnormal, 0),
    },
  ]
  return { cards, modules, stationStatuses }
}

export { getRevision }
