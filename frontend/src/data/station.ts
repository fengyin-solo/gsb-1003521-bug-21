import { deriveStationOwner, listRows } from './local-store'
import type { EntryRow } from './types'

// 监测站点域：所有监测记录（水位、流量、巡检等）都通过这里回查站点，
// 站点编号、运行状态、管理单位的口径因此只有一份。

export const STATION_MODULE = 'station'
export const STATION_CODE_FIELD = '站点编号'
export const STATION_RIVER_FIELD = '所在河流'
export const STATION_OWNER_FIELD = '管理单位'
export const STATION_REVOKED_AT_FIELD = '撤销时间'

export const STATION_STATUS = {
  normal: '正常运行',
  fault: '设备故障',
  flood: '汛期加强',
  suspended: '暂停运行',
  revoked: '已撤销',
} as const

export function stationRows(): EntryRow[] {
  return listRows(STATION_MODULE)
}

export function findStation(code: string, rows: EntryRow[] = stationRows()): EntryRow | undefined {
  const target = code.trim()
  return rows.find((row) => String(row[STATION_CODE_FIELD] ?? '').trim() === target)
}

export function stationStatus(station: EntryRow): string {
  return String(station.status)
}

/** 旧站点缺少管理单位时按所在河流回填：先取同河流其他站点的单位，再退化为河流管理处。 */
export function deriveOwner(river: string): string {
  // 用运行时数据回填（含旧缓存里的站点）；local-store 装载时已做过一次同样的回填。
  return deriveStationOwner(river, { [STATION_MODULE]: stationRows() })
}

/**
 * 站点归属与运行状态校验。返回 null 表示放行，否则返回拒绝原因。
 * 撤销站点只允许补报撤销时间之前（严格早于）的历史观测；没有撤销时间的旧数据一律拦下。
 */
export function checkStationForSubmit(
  stationCode: string,
  observedAt: string | undefined,
  rows: EntryRow[] = stationRows(),
): string | null {
  const code = stationCode.trim()
  if (!code) {
    return '记录缺少站点编号，无法核对站点归属'
  }
  const station = findStation(code, rows)
  if (!station) {
    return `站点编号「${code}」在监测站点中不存在，请先登记或核对归属`
  }
  if (stationStatus(station) === STATION_STATUS.revoked) {
    const revokedAt = String(station[STATION_REVOKED_AT_FIELD] ?? '').trim()
    const observed = String(observedAt ?? '').trim()
    if (!observed) {
      return `站点「${code}」已撤销，且未提供观测时间，不能补报历史观测`
    }
    if (!revokedAt) {
      return `站点「${code}」已撤销（旧数据缺少撤销时间），请先补齐撤销时间后再补报历史观测`
    }
    if (observed >= revokedAt) {
      return `站点「${code}」已于 ${revokedAt} 撤销，只能补报该时间之前的历史观测`
    }
  }
  return null
}
