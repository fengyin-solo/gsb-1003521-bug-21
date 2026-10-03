/**
 * 数据链路校验脚本（Node 直跑，不依赖浏览器）：
 *   npx esbuild scripts/verify-data-flow.ts --bundle --platform=node --format=esm | node
 * 覆盖：旧数据迁移与回填、撤销/暂停后提交口径、历史补录、归属缺失拦截、
 *      并发撤销与提交只有一个结果、状态口径三处一致、写盘失败整体回退。
 */

class MemoryStorage {
  private map = new Map<string, string>()
  private failOnce = false

  get length() {
    return this.map.size
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  setItem(key: string, value: string) {
    if (this.failOnce) {
      this.failOnce = false
      throw new Error('模拟磁盘写入失败')
    }
    this.map.set(key, String(value))
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  armFailure() {
    this.failOnce = true
  }
  seed(key: string, value: string) {
    this.map.set(key, value)
  }
}

const storage = new MemoryStorage()
;(globalThis as { window: unknown }).window = {
  localStorage: storage,
  addEventListener: () => undefined,
}

const results: { name: string; ok: boolean; detail: string }[] = []
function check(name: string, condition: boolean, detail = '') {
  results.push({ name, ok: condition, detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}`)
}

async function main() {
  const {
    runAction,
    loadOverview,
    getStationDetail,
    computeStats,
    getEntry,
  } = await import('../src/api/local-service')
  const { MODULE_BY_KEY } = await import('../src/data/modules')
  const { authorityByRiver } = await import('../src/data/domain')
  const store = await import('../src/data/local-store')

  // ---- 1. 全新播种：老站点 STAT-0004 缺管理单位，按淮河回填 ----
  const filled = getEntry('station', 4)
  check(
    '老站点缺少管理单位时按所在河流回填',
    filled?.['管理单位'] === '淮河水利委员会',
    `管理单位=${String(filled?.['管理单位'])}`,
  )
  check('河流映射兜底存在', authorityByRiver('某无名河') === '省水文水资源勘测局')

  // ---- 2. 站点表运行状态与主状态同源 ----
  const faultStation = getEntry('station', 2)
  check(
    '故障站运行状态字段不再误显示为正常',
    faultStation?.status === '设备故障' && faultStation?.['运行状态'] === '设备故障',
  )

  // ---- 3. 撤销后的新观测禁止提交；停用前历史观测允许补录 ----
  const afterRevoke = await runAction('waterlevel', 4, '提交审核') // STAT-0004 2026-04-02 >= 2026-03-31
  check('撤销后新水位记录提交被拒', !afterRevoke.ok, afterRevoke.message)
  const beforeRevoke = await runAction('waterlevel', 3, '提交审核') // STAT-0004 2026-03-28 < 2026-03-31
  check('撤销前历史水位记录允许补录提交', beforeRevoke.ok, beforeRevoke.message)

  const inspectionAfter = await runAction('inspection', 4, '完成巡检') // STAT-0004 2026-04-05
  check('撤销后新巡检记录提交被拒', !inspectionAfter.ok, inspectionAfter.message)
  const inspectionBefore = await runAction('inspection', 3, '确认处置') // 已巡检的历史记录做处置
  check('撤销前的巡检历史记录仍可处置', inspectionBefore.ok, inspectionBefore.message)

  const houseAfter = await runAction('stationhouse', 3, '安排维护') // 2026-05-02
  check('撤销后新站房维护安排被拒', !houseAfter.ok, houseAfter.message)
  const houseBefore = await runAction('stationhouse', 2, '安排维护') // 2026-03-25
  check('撤销前站房维护补录允许', houseBefore.ok, houseBefore.message)

  // ---- 4. 归属站点不存在：提交类动作统一拦截 ----
  const orphan = await runAction('waterlevel', 5, '提交审核') // STAT-0999
  check('归属站点缺失的记录不能提交', !orphan.ok, orphan.message)

  // 故障站仍在运行：其记录可以继续处理
  const faultSubmit = await runAction('waterlevel', 2, '确认通过')
  check('故障站记录可正常处理（故障≠停用）', faultSubmit.ok, faultSubmit.message)

  // ---- 5. 站点动作护栏：撤销站不能重复撤销 ----
  const repeatRevoke = await runAction('station', 4, '撤销站点')
  check('已撤销站点重复撤销被拒', !repeatRevoke.ok, repeatRevoke.message)

  // ---- 6. 并发：撤销站点 与 该站点记录提交同时发生，只有一个成功 ----
  // 把 DISC-0001 的测量时间改为当天，保证「撤销先到」时提交不落在历史补录窗口内。
  const today = new Date().toISOString().slice(0, 10)
  store.mutateRows((draft) => {
    const rec = draft.discharge.find((r) => r.id === 1)
    if (rec) {
      rec['测量时间'] = today
    }
    return { value: undefined, commit: true }
  })
  const race = await Promise.all([
    runAction('station', 3, '撤销站点'),
    runAction('discharge', 1, '提交审核'),
  ])
  const okCount = race.filter((r) => r.ok).length
  check('并发撤销与提交恰好一个成功', okCount === 1, `成功数=${okCount}：${race.map((r) => r.message).join(' / ')}`)
  const station3 = getEntry('station', 3)
  if (station3?.status === '已撤销') {
    const record = getEntry('discharge', 1)
    check(
      '撤销先到时提交被拒且记录保持原状态',
      record?.status === '已采集',
      `流量记录状态=${String(record?.status)}`,
    )
    check('撤销时写入停用时间', String(station3['停用时间'] ?? '') !== '')
  } else {
    const record = getEntry('discharge', 1)
    check(
      '提交先到时记录已进入待审核，站点仍为汛期加强',
      record?.status === '待审核' && station3?.status === '汛期加强',
      `记录=${String(record?.status)}，站点=${String(station3?.status)}`,
    )
  }

  // ---- 7. 列表 / 详情 / 概览状态口径一致 ----
  const overview = loadOverview()
  const stationModule = overview.modules.find((m) => m.name === '监测站点')
  const stationMeta = MODULE_BY_KEY.get('station')!
  const [statsTotal, statsNormal, statsFault] = computeStats(stationMeta)
  const overviewNormal = overview.stationStatuses.find((s) => s.status === '正常运行')?.count
  const detail = getStationDetail(2)
  check('站点总数口径一致', statsTotal === stationModule?.created, `指标卡=${statsTotal}，概览=${stationModule?.created}`)
  check(
    '故障数口径一致（指标卡=概览模块行）',
    statsFault === stationModule?.abnormal,
    `指标卡故障=${statsFault}，概览异常=${stationModule?.abnormal}`,
  )
  check(
    '正常运行数口径一致（指标卡=概览状态分布）',
    statsNormal === overviewNormal,
    `指标卡正常=${statsNormal}，概览=${overviewNormal}`,
  )
  check('站点详情读到的故障站状态一致', detail?.station.status === '设备故障')
  check(
    '站点详情汇聚了归属记录（STAT-0002 的水位/流量/巡检/遥测等）',
    (detail?.totals.reduce((sum, t) => sum + t.count, 0) ?? 0) >= 3,
    `归属记录合计=${detail?.totals.reduce((sum, t) => sum + t.count, 0)}`,
  )

  // ---- 8. 旧版 localStorage 迁移：真实数据回填 + 占位示例整批换新 ----
  storage.clear()
  storage.seed(
    'hydrology-monitor-station:entries',
    JSON.stringify({
      station: [
        {
          id: 1,
          status: '正常运行',
          pending: true,
          abnormal: false,
          站点编号: 'STAT-0001',
          站点名称: '老站',
          站点类型: '河道站',
          所在河流: '汉江',
          经纬度坐标: 'x',
          建站年份: '1990',
          管理单位: '',
          运行状态: '正常运行',
        },
      ],
      waterlevel: [
        {
          id: 1,
          status: '已采集',
          pending: false,
          abnormal: true, // 旧布尔位失真
          记录编号: 'WL-1',
          站点编号: 'WL-1', // 旧自由文本，按尾部数字对齐到 STAT-0001
          观测时间: '2026-09-01',
        },
      ],
    }),
  )
  store.__reloadForTests()
  check(
    '迁移回填：汉江老站 -> 长江水利委员会',
    store.listRows('station')[0]['管理单位'] === '长江水利委员会',
    `管理单位=${String(store.listRows('station')[0]['管理单位'])}`,
  )
  check(
    '迁移对齐：尾部数字编号映射到真实站点',
    store.listRows('waterlevel')[0]['站点编号'] === 'STAT-0001',
    `对齐结果=${String(store.listRows('waterlevel')[0]['站点编号'])}`,
  )
  check(
    '迁移按状态集合重算布尔位（旧异常位被纠正）',
    store.listRows('waterlevel')[0].pending === true && store.listRows('waterlevel')[0].abnormal === false,
  )
  check('旧键迁移后被删除', storage.getItem('hydrology-monitor-station:entries') === null)

  // 占位示例旧库：整批替换成相互关联的新种子
  storage.clear()
  storage.seed(
    'hydrology-monitor-station:entries',
    JSON.stringify({ station: [{ id: 1, 站点名称: '监测站点样例1', 管理单位: '监测站点样例1' }] }),
  )
  store.__reloadForTests()
  const seeded = store.listRows('station')
  check(
    '占位示例旧库整批替换为新种子',
    seeded.some((s) => s['站点编号'] === 'STAT-0004' && s['管理单位'] === '淮河水利委员会'),
    `站点数=${seeded.length}`,
  )

  // ---- 9. 写盘失败：整体回退，三个视角都读不到半成品 ----
  const beforeRevision = store.getRevision()
  const beforeStatus = getEntry('station', 1)?.status
  const beforeOverview = JSON.stringify(loadOverview())
  const beforeDetailStatus = getStationDetail(1)?.station.status
  storage.armFailure()
  let threw = false
  try {
    await runAction('station', 1, '登记故障')
  } catch (error) {
    threw = true
    check('写盘失败时向上抛出回退提示', /回滚/.test(error instanceof Error ? error.message : ''))
  }
  check('写盘失败会抛错而不是假成功', threw)
  check('回退后版本号不增加', store.getRevision() === beforeRevision)
  check('回退后列表状态保持操作前', getEntry('station', 1)?.status === beforeStatus)
  check('回退后详情状态保持操作前', getStationDetail(1)?.station.status === beforeDetailStatus)
  check('回退后运营概览与操作前完全一致', JSON.stringify(loadOverview()) === beforeOverview)

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
