import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import { projectRow } from './status'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 版本号随状态口径/种子结构调整递增：旧缓存结构不一致，直接作废重播种。
const STORAGE_KEY = 'hydrology-monitor-station:entries:v2'

// 监测站点域字段：与 data/station.ts 同口径，本地层在装载时直接做一次归属回填。
const STATION_MODULE = 'station'
const STATION_RIVER_FIELD = '所在河流'
const STATION_OWNER_FIELD = '管理单位'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 旧站点缺少管理单位时按所在河流回填：先沿用同河流其他站点的单位，再退化为河流管理处。 */
export function deriveStationOwner(
  river: string,
  all: Record<string, EntryRow[]> = SEED_ROWS,
): string {
  const name = river.trim()
  const stations = all[STATION_MODULE] ?? []
  const known = stations.find(
    (row) =>
      String(row[STATION_RIVER_FIELD] ?? '').trim() === name &&
      String(row[STATION_OWNER_FIELD] ?? '').trim() !== '',
  )
  if (known) {
    return String(known[STATION_OWNER_FIELD])
  }
  return `${name}流域管理处`
}

function backfillStationOwners(all: Record<string, EntryRow[]>): boolean {
  let changed = false
  const stations = all[STATION_MODULE]
  if (!stations) {
    return false
  }
  for (const row of stations) {
    const owner = String(row[STATION_OWNER_FIELD] ?? '').trim()
    if (owner === '') {
      const river = String(row[STATION_RIVER_FIELD] ?? '').trim()
      row[STATION_OWNER_FIELD] = river ? deriveStationOwner(river, all) : '未划分流域管理处'
      changed = true
    }
  }
  return changed
}

/**
 * 装载后归一化：status 是唯一权威状态，pending/abnormal 与各模块的状态镜像字段
 * （如「记录状态」「设备状态」）一律按状态口径重算，种子/旧缓存里的错位值在此被纠正。
 */
function normalize(raw: Record<string, EntryRow[]>): boolean {
  let changed = backfillStationOwners(raw)
  for (const [key, rows] of Object.entries(raw)) {
    const meta = MODULE_BY_KEY.get(key)
    if (!meta || !Array.isArray(rows)) {
      continue
    }
    for (let i = 0; i < rows.length; i += 1) {
      const projected = projectRow(meta, rows[i])
      const before = rows[i]
      if (
        before.pending !== projected.pending ||
        before.abnormal !== projected.abnormal ||
        (meta.statusField && before[meta.statusField] !== projected.status)
      ) {
        rows[i] = projected
        changed = true
      }
    }
  }
  return changed
}

function persist(data: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    normalize(fallback)
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  let data: Record<string, EntryRow[]>
  if (!raw) {
    data = fallback
  } else {
    try {
      const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
      data = { ...fallback, ...parsed }
    } catch {
      data = fallback
    }
  }
  if (normalize(data)) {
    // 只做一次性的口径纠偏（状态镜像/缺单位回填），不改写用户的业务字段。
    persist(data)
  }
  return data
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// —— 变更订阅：动作提交后列表、详情页、运营概览统一从这里收到通知并整体重读 ——

export type StoreListener = () => void

const listeners = new Set<StoreListener>()
let version = 0

export function subscribe(listener: StoreListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function storeVersion(): number {
  return version
}

function notify(): void {
  version += 1
  listeners.forEach((listener) => listener())
}

/**
 * 事务式写入：先在快照副本上改，整体成功才落库；中途抛错就回滚到提交前快照，
 * 不会出现「站点已撤销但记录也提交了一半」的中间态。
 */
export function mutate(
  mutator: (draft: Record<string, EntryRow[]>) => void,
): Record<string, EntryRow[]> {
  const snapshot = clone(allRows())
  const draft = clone(snapshot)
  try {
    mutator(draft)
    cache = draft
    persist(draft)
  } catch (error) {
    cache = snapshot
    try {
      persist(snapshot)
    } catch {
      // 回滚落库失败时仍保留内存快照，保证本次会话口径一致。
    }
    throw error
  }
  notify()
  return draft
}

export function saveRows(key: string, rows: EntryRow[]): void {
  mutate((draft) => {
    draft[key] = rows
  })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  const meta = MODULE_BY_KEY.get(key)
  const normalized = meta ? rows.map((row) => projectRow(meta, row)) : rows
  saveRows(key, normalized)
  return normalized
}

export function storageKey(): string {
  return STORAGE_KEY
}
