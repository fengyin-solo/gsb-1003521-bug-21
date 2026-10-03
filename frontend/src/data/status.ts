import type { EntryRow, ModuleMeta } from './types'

// 状态口径的唯一来源：行上的 status 是权威字段，pending/abnormal 只允许由状态推导，
// 列表、详情、运营概览、动作落库都走这里，避免各处各算一套。

export function terminalStatusOf(meta: ModuleMeta): string {
  return meta.terminalStatus ?? meta.statuses[meta.statuses.length - 1]
}

export function pendingStatusesOf(meta: ModuleMeta): Set<string> {
  const terminal = terminalStatusOf(meta)
  const list = meta.pendingStatuses ?? meta.statuses.filter((s) => s !== terminal)
  return new Set(list)
}

export function abnormalStatusesOf(meta: ModuleMeta): Set<string> {
  return new Set(meta.abnormalStatuses ?? [])
}

export function isPending(meta: ModuleMeta, status: string): boolean {
  return pendingStatusesOf(meta).has(status)
}

export function isAbnormal(meta: ModuleMeta, status: string): boolean {
  return abnormalStatusesOf(meta).has(status)
}

export function isTerminal(meta: ModuleMeta, status: string): boolean {
  return terminalStatusOf(meta) === status
}

/** 把状态口径写进行：冗余的状态镜像字段也同步投影成权威 status，两处永远一致。 */
export function projectRow(meta: ModuleMeta, row: EntryRow): EntryRow {
  const status = String(row.status)
  const next: EntryRow = {
    ...row,
    status,
    pending: isPending(meta, status),
    abnormal: isAbnormal(meta, status),
  }
  if (meta.statusField) {
    next[meta.statusField] = status
  }
  return next
}
