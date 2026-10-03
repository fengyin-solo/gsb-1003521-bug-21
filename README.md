# 水文监测站网管理系统

面向水文监测站点运行、水位流量雨量数据采集、遥测设备维护与数据整编发布的水文站网管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 监测站点 | `station` | 水文监测站 | 站点编号、站点名称、站点类型 |
| 水位监测 | `waterlevel` | 水位记录 | 记录编号、站点编号、观测时间 |
| 流量监测 | `discharge` | 流量记录 | 记录编号、站点编号、测量方法 |
| 雨量观测 | `rainfall` | 雨量记录 | 记录编号、站点编号、观测时段 |
| 水质检测 | `waterquality` | 水质检测报告 | 报告编号、采样站点、采样时间 |
| 断面测量 | `crosssection` | 断面测量记录 | 记录编号、站点编号、断面名称 |
| 遥测设备 | `telemetry` | 遥测设备 | 设备编号、设备类型、所属站点 |
| 数据整编 | `compilation` | 整编成果 | 成果编号、整编年份、站点编号 |
| 预警阈值 | `warning` | 预警阈值配置 | 配置编号、站点编号、监测类型 |
| 地下水观测 | `groundwater` | 地下水观测记录 | 记录编号、井点编号、观测日期 |
| 蒸发观测 | `evaporation` | 蒸发观测记录 | 记录编号、站点编号、观测日期 |
| 测流缆道 | `cableway` | 测流缆道 | 缆道编号、所属站点、跨度米数 |
| 泥沙监测 | `sediment` | 泥沙监测记录 | 记录编号、站点编号、采样时间 |
| 通讯系统 | `communication` | 通讯设备 | 设备编号、设备类型、所属站点 |
| 站房维护 | `stationhouse` | 站房维护记录 | 记录编号、站点编号、维护类型 |
| 仪器检定 | `calibration` | 仪器检定记录 | 记录编号、仪器编号、仪器名称 |
| 巡检记录 | `inspection` | 巡检记录 | 记录编号、站点编号、巡检日期 |
| 测报方案 | `plan` | 测报方案 | 方案编号、方案名称、适用范围 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`；站点状态口径、河流→管理单位映射在 `frontend/src/data/domain.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `hydrology-monitor-station:entries:v2` 这一项，或调用
  `resetModule(模块)`；旧版无版本号键（`hydrology-monitor-station:entries`）首次加载时自动迁移。

## 站点归属与状态口径

- 各监测记录通过模块元数据里的 `stationField` 归属到监测站点（如「站点编号」「所属站点」「采样站点」），
  `timeField` 用于区分历史观测与新观测，`submitActions` 声明会产生新数据的提交动作。
- 提交类动作（提交审核、完成巡检、安排维护等）统一校验：站点必须存在；站点已撤销/暂停时，
  仅允许补录「停用时间」之前的历史观测，之后的新观测一律拒绝。审核、通过、标记异常等
  对存量记录的处理动作不受影响。
- 站点动作有起始状态护栏：撤销只能从运行态（正常运行/设备故障/汛期加强）发起，已撤销不能重复撤销。
- 列表指标卡、站点详情、运营概览全部通过 `computeStats` / 模块声明的 `pendingStatuses`、
  `abnormalStatuses` 取数，不再信任记录行上可能失真的布尔标志；站点表「运行状态」字段是
  `status` 的镜像，动作流转时强制同步。
- 老站点缺少管理单位时，按所在河流回填流域管理单位（长江/黄河/淮河/海河/珠江/松辽水利委员会、
  太湖流域管理局，匹配不到时兜底为省水文水资源勘测局）。
- 所有动作经单任务队列串行执行，配合整份快照事务落盘：并发撤销与提交只有一个结果落盘；
  写盘失败时内存快照整体回滚并通过订阅通知列表、详情、运营概览一起重读。

## 数据链路自检

```bash
cd frontend
node -e "require('esbuild').build({entryPoints:['scripts/verify-data-flow.ts'],bundle:true,platform:'node',format:'esm',write:false}).then(r=>require('fs').writeFileSync('/tmp/verify.mjs',r.outputFiles[0].text))" && node /tmp/verify.mjs
```

