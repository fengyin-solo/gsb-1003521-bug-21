import type { ModuleMeta } from './types'

/**
 * 站点状态的统一口径。站点列表、站点详情、运营概览以及各监测记录的归属校验
 * 全部以此处为准，避免同一站点在不同页面状态对不上。
 */
export const STATION_STATUS = {
  normal: '正常运行',
  fault: '设备故障',
  flood: '汛期加强',
  suspended: '暂停运行',
  revoked: '已撤销',
} as const

/** 站点可承接新观测/新巡检的状态：故障、汛期加强都还在运行，只是要重点盯。 */
export const ACTIVE_STATION_STATUSES: readonly string[] = [
  STATION_STATUS.normal,
  STATION_STATUS.fault,
  STATION_STATUS.flood,
]

/** 站点终止态：撤销后不再运行，记录补录只开放到「停用时间」之前的历史观测。 */
export const INACTIVE_STATION_STATUSES: readonly string[] = [
  STATION_STATUS.suspended,
  STATION_STATUS.revoked,
]

/**
 * 各站点动作允许的起始状态。撤销/暂停不是「失败」，但只能从仍在运行的站点发起，
 * 保证撤销与提交并发时两边读到的站点口径一致。
 */
export const STATION_ACTION_GUARDS: Record<string, { from: readonly string[]; blocked: string }> = {
  升级为加强: {
    from: [STATION_STATUS.normal, STATION_STATUS.fault],
    blocked: '只有正常运行或设备故障的站点可以升级为汛期加强',
  },
  登记故障: {
    from: [STATION_STATUS.normal, STATION_STATUS.flood],
    blocked: '站点不在运行状态（汛期加强/正常运行），不能登记故障',
  },
  撤销站点: {
    from: ACTIVE_STATION_STATUSES,
    blocked: '站点已撤销或暂停，不能重复停用',
  },
}

/** 站点状态变更时间字段：撤销/暂停时写入，历史观测补录用它做截止线。 */
export const STATION_INACTIVE_SINCE_FIELD = '停用时间'

/** 站点编号字段、运行状态字段（站点表内与 status 同源，动作流转时强制同步）。 */
export const STATION_CODE_FIELD = '站点编号'
export const STATION_RUNNING_FIELD = '运行状态'

/** 河流 → 流域管理单位：老站点缺少管理单位时按所在河流回填。 */
const RIVER_AUTHORITY_TABLE: { match: string[]; authority: string }[] = [
  { match: ['长江', '汉江', '湘江', '赣江', '嘉陵江', '乌江', '岷江', '沱江', '洞庭湖', '鄱阳湖'], authority: '长江水利委员会' },
  { match: ['黄河', '渭河', '汾河', '洛河', '沁河', '湟水', '洮河'], authority: '黄河水利委员会' },
  { match: ['淮河', '沂河', '沭河', '泗河', '沙颍河'], authority: '淮河水利委员会' },
  { match: ['海河', '滦河', '永定河', '大清河', '漳河'], authority: '海河水利委员会' },
  { match: ['珠江', '西江', '北江', '东江', '韩江'], authority: '珠江水利委员会' },
  { match: ['松花江', '辽河', '嫩江', '黑龙江', '乌苏里江', '浑河', '太子河'], authority: '松辽水利委员会' },
  { match: ['太湖', '黄浦江', '吴淞江', '苕溪'], authority: '太湖流域管理局' },
]

/** 按所在河流推断管理单位；都匹配不上时给出省级水文局兜底，保证一定能回填。 */
export function authorityByRiver(river: string): string {
  const name = String(river ?? '').trim()
  if (!name) {
    return '省水文水资源勘测局'
  }
  const hit = RIVER_AUTHORITY_TABLE.find((item) => item.match.some((keyword) => name.includes(keyword)))
  return hit ? hit.authority : '省水文水资源勘测局'
}

export function isActiveStation(status: string): boolean {
  return ACTIVE_STATION_STATUSES.includes(status)
}

export function isStationStatus(status: string): boolean {
  return new Set([...ACTIVE_STATION_STATUSES, ...INACTIVE_STATION_STATUSES]).has(status)
}

/** 运营概览的「待处理/异常量」口径：由模块状态集合推导，不依赖行上可能失真的布尔位。 */
export function isPendingStatus(meta: ModuleMeta, status: string): boolean {
  return meta.pendingStatuses.includes(status)
}

export function isAbnormalStatus(meta: ModuleMeta, status: string): boolean {
  return meta.abnormalStatuses.includes(status)
}
