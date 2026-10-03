/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 终态：处于该状态的记录不再允许任何动作。默认取 statuses 的最后一个。 */
  terminalStatus?: string
  /** 待处理状态：运营概览「待处理」与列表统计的唯一口径。默认取除终态外的全部状态。 */
  pendingStatuses?: string[]
  /** 异常状态：运营概览「异常量」的唯一口径，不再按动作名猜测。默认无异常。 */
  abnormalStatuses?: string[]
  /** 行内冗余的状态镜像字段（如「记录状态」），读取数时统一投影为权威 status。 */
  statusField?: string
  /** 记录中引用站点编号的字段：提交类动作据此做站点归属与运行状态校验。 */
  stationRef?: string
  /** 观测/业务日期字段：撤销站点仅允许补报撤销时间之前的历史观测。 */
  dateField?: string
  /** 「提交」语义的动作：执行前必须通过站点归属与站点状态校验。 */
  submitActions?: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type StationSummary = {
  total: number
  normal: number
  fault: number
  suspended: number
  revoked: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  station: StationSummary
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
