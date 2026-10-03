import { MODULE_BY_KEY, MODULES } from './modules'
import { SEED_ROWS } from './seed'
import {
  authorityByRiver,
  isAbnormalStatus,
  isPendingStatus,
  isStationStatus,
  STATION_CODE_FIELD,
  STATION_INACTIVE_SINCE_FIELD,
  STATION_RUNNING_FIELD,
} from './domain'
import type { EntryRow } from './types'

/**
 * 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都在。
 * v2 起采用「信封」结构 { revision, rows }：每次成功提交 revision+1，
 * 撤销/提交并发时靠事务内的全量快照保证要么整份生效、要么整体回退。
 */
const STORAGE_KEY = 'hydrology-monitor-station:entries:v2'
const LEGACY_STORAGE_KEY = 'hydrology-monitor-station:entries'
const START_REVISION = 1

type Envelope = { revision: number; rows: Record<string, EntryRow[]> }
type ChangeReason = 'commit' | 'rollback' | 'cross-tab'
type StoreListener = (reason: ChangeReason, revision: number) => void

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

/** 旧版示例数据的字段里都带「样例」字样，识别后整批丢弃，换成相互关联的新种子。 */
function looksLikePlaceholder(rows: Record<string, unknown>): boolean {
  return Object.values(rows).some((list) =>
    Array.isArray(list) &&
    list.some((row) =>
      row && typeof row === 'object' &&
      Object.values(row as Record<string, unknown>).some((value) =>
        typeof value === 'string' && value.includes('样例'),
      ),
    ),
  )
}

function normalizeStation(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row, id: Number(row.id) }
  if (!isStationStatus(String(next.status))) {
    next.status = '正常运行'
  }
  // 站点表内「运行状态」只是 status 的镜像字段，统一在这里回写，两处口径永远一致。
  next[STATION_RUNNING_FIELD] = next.status
  if (String(next[STATION_INACTIVE_SINCE_FIELD] ?? '').trim() === '') {
    next[STATION_INACTIVE_SINCE_FIELD] = ''
  }
  // 老站点缺少管理单位：按所在河流对应的流域管理单位回填。
  if (String(next['管理单位'] ?? '').trim() === '') {
    next['管理单位'] = authorityByRiver(String(next['所在河流'] ?? ''))
  }
  return next
}

/** 把旧版自由文本的站点引用尽量对应到真实站点：按编号尾部数字对齐（STAT-0001 ↔ WL-1），对不上就保留。 */
function reconcileStationCode(value: string, exactCodes: Set<string>, numberToCode: Map<number, string>): string {
  const code = String(value ?? '').trim()
  if (!code || exactCodes.has(code)) {
    return code
  }
  const tail = /(\d{1,4})\s*$/.exec(code)
  if (!tail) {
    return code
  }
  return numberToCode.get(Number(tail[1])) ?? code
}

/**
 * 统一归一化：状态非法兜底、站点标志与字段口径重算、
 * pending/abnormal 一律按模块声明的状态集合推导（旧布尔位不再被信任）。
 */
export function normalizeRows(raw: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const out: Record<string, EntryRow[]> = {}

  // 第一遍：逐模块清洗，站点单独走站点规则。
  for (const meta of MODULES) {
    const source = Array.isArray(raw[meta.key]) ? raw[meta.key] : SEED_ROWS[meta.key] ?? []
    out[meta.key] = source.map((input) => {
      if (meta.key === 'station') {
        const station = normalizeStation(input)
        station.pending = isPendingStatus(meta, String(station.status))
        station.abnormal = isAbnormalStatus(meta, String(station.status))
        return station
      }
      const status = meta.statuses.includes(String(input.status)) ? String(input.status) : meta.statuses[0]
      const next: EntryRow = { ...input, id: Number(input.id), status }
      next.pending = isPendingStatus(meta, status)
      next.abnormal = isAbnormalStatus(meta, status)
      return next
    })
  }

  // 第二遍：各监测记录的站点引用按真实站点表对齐。
  const stations = out.station ?? []
  const exactCodes = new Set<string>()
  const numberToCode = new Map<number, string>()
  for (const station of stations) {
    const code = String(station[STATION_CODE_FIELD] ?? '').trim()
    exactCodes.add(code)
    const tail = /(\d{1,4})\s*$/.exec(code)
    if (tail && !numberToCode.has(Number(tail[1]))) {
      numberToCode.set(Number(tail[1]), code)
    }
  }
  for (const meta of MODULES) {
    if (!meta.stationField || meta.key === 'station') {
      continue
    }
    for (const entry of out[meta.key]) {
      entry[meta.stationField] = reconcileStationCode(
        String(entry[meta.stationField] ?? ''),
        exactCodes,
        numberToCode,
      )
    }
  }
  return out
}

function writeEnvelope(revision: number, rows: Record<string, EntryRow[]>): void {
  if (!hasStorage()) {
    return
  }
  // 单键整体写：浏览器在两次 setItem 之间不会观察到中间态，失败时旧数据原样保留。
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ revision, rows }))
}

function readEnvelope(): { revision: number; rows: Record<string, EntryRow[]> } {
  if (!hasStorage()) {
    return { revision: START_REVISION, rows: normalizeRows(clone(SEED_ROWS)) }
  }

  const rawV2 = window.localStorage.getItem(STORAGE_KEY)
  if (rawV2) {
    try {
      const envelope = JSON.parse(rawV2) as Envelope
      return {
        revision: Number(envelope.revision) || START_REVISION,
        rows: normalizeRows(envelope.rows ?? {}),
      }
    } catch {
      // v2 数据损坏：落到迁移分支重新播种，不让整页白屏。
    }
  }

  let incoming: Record<string, EntryRow[]> = clone(SEED_ROWS)
  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as Record<string, EntryRow[]>
      // 旧示例数据站点与记录完全对不上，直接丢弃；真实录入的数据做迁移对齐。
      if (parsed && typeof parsed === 'object' && !looksLikePlaceholder(parsed as Record<string, unknown>)) {
        incoming = parsed
      }
    } catch {
      // 旧数据无法解析时按新种子播种。
    }
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  }

  const rows = normalizeRows(incoming)
  writeEnvelope(START_REVISION, rows)
  return { revision: START_REVISION, rows }
}

let cache: Record<string, EntryRow[]> | null = null
let revision = 0
const listeners = new Set<StoreListener>()

function ensureLoaded(): void {
  if (cache === null) {
    const envelope = readEnvelope()
    cache = envelope.rows
    revision = envelope.revision
  }
}

export function allRows(): Record<string, EntryRow[]> {
  ensureLoaded()
  return cache as Record<string, EntryRow[]>
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function getRevision(): number {
  ensureLoaded()
  return revision
}

/** 测试辅助：丢弃内存缓存，按当前 localStorage 内容重新加载（走迁移路径）。 */
export function __reloadForTests(): void {
  cache = null
  revision = 0
  listeners.clear()
  ensureLoaded()
}

export function subscribe(listener: StoreListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(reason: ChangeReason): void {
  listeners.forEach((listener) => listener(reason, revision))
}

/**
 * 事务式修改：mutator 在整份快照的克隆上操作，返回 commit=false 表示业务校验未过、不落盘；
 * commit=true 时一次性整体写盘，写盘失败恢复旧快照并通知全部页面回退。
 * 调用方需自行串行化（见 local-service 的任务队列），保证并发撤销/提交只有一个结果。
 */
export function mutateRows<T>(
  mutator: (draft: Record<string, EntryRow[]>) => { value: T; commit: boolean },
): { committed: boolean; value: T; revision: number } {
  ensureLoaded()
  const previous = cache as Record<string, EntryRow[]>
  const draft = clone(previous)
  const outcome = mutator(draft)
  if (!outcome.commit) {
    return { committed: false, value: outcome.value, revision }
  }

  const normalized = normalizeRows(draft)
  const nextRevision = revision + 1
  try {
    writeEnvelope(nextRevision, normalized)
  } catch (error) {
    // 持久化失败：内存快照回滚到事务前，列表/详情/运营概览订阅后统一重读。
    cache = previous
    notify('rollback')
    throw new Error(
      `数据写入失败，已回滚到操作前状态（${error instanceof Error ? error.message : '未知错误'}）`,
    )
  }
  cache = normalized
  revision = nextRevision
  notify('commit')
  return { committed: true, value: outcome.value, revision }
}

export function saveRows(key: string, rows: EntryRow[]): void {
  mutateRows((draft) => {
    draft[key] = clone(rows)
    return { value: undefined, commit: true }
  })
}

export function resetRows(key: string): EntryRow[] {
  mutateRows((draft) => {
    draft[key] = clone(SEED_ROWS[key] ?? [])
    return { value: undefined, commit: true }
  })
  return listRows(key)
}

// 跨标签页：另一个标签提交/回退后，本标签直接采用其信封并刷新所有订阅页面。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) {
      return
    }
    try {
      const envelope = JSON.parse(event.newValue) as Envelope
      cache = normalizeRows(envelope.rows ?? {})
      revision = Number(envelope.revision) || revision
      notify('cross-tab')
    } catch {
      // 对侧写入了无法解析的内容时保持当前快照，不做破坏性处理。
    }
  })
}
