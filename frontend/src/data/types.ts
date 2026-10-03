/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

/** 概览指标的取数口径：全部以各模块声明的状态集合为准，列表/详情/概览共用同一套算法。 */
export type MetricKind = 'total' | 'pending' | 'abnormal' | 'status'

export type MetricSpec = {
  label: string
  kind: MetricKind
  /** kind 为 'status' 时，统计恰好处于该状态的行数（如「正常运行数」）。 */
  status?: string
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
  /** 页面指标卡：口径集中在这里，页面不再各自写死计数规则。 */
  metricSpecs: MetricSpec[]
  /** 待处理状态集合：处于这些状态的行在运营概览里计入「待处理」。 */
  pendingStatuses: string[]
  /** 异常状态集合：设备故障、记录异常、需重测等需要人工处置的行计入「异常量」。 */
  abnormalStatuses: string[]
  /**
   * 归属站点的字段名（如「站点编号」「所属站点」）。
   * 声明后，该模块动作会统一做站点归属校验；未声明则与站点无关，不校验。
   */
  stationField?: string
  /**
   * 观测/发生时间字段名。
   * 声明后，站点撤销/暂停仍允许补录「停用时间」之前的历史观测，之后的新观测禁止提交。
   */
  timeField?: string
  /**
   * 会产生新观测数据、必须落在站点运行期内的「提交」动作。
   * 其他动作（审核、通过、标记异常等）只是处理已有记录，站点撤销后仍允许。
   */
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

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
  /** 监测站点运行状态分布：站点列表与运营概览共用同一份计数。 */
  stationStatuses: { status: string; count: number }[]
}

/** 站点详情：站点本体 + 各监测模块归属到该站点的记录（动作到取数的汇聚链路）。 */
export type StationRelatedGroup = {
  key: string
  name: string
  stationField: string
  items: EntryRow[]
}

export type StationDetail = {
  station: EntryRow
  related: StationRelatedGroup[]
  totals: { name: string; count: number }[]
}
