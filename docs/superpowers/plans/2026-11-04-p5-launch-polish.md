# P5 实施计划：上线与打磨（板块 08）

日期：2026-11-04 ｜ 分支：master ｜ 执行方式：subagent-driven development

## 目标

完成 08 板块的性能预算与交付通道：Draco 压缩（01 的 <8MB 线复验）、构建分包、
Service Worker 缓存、相对路径部署配置、Lighthouse 实测。真机/4 浏览器人工项标注。

## 已核实环境

- Node 便携版（每条命令前注入）：
  `$env:Path = "C:\Users\Lenovo\.local\lib\node-v22.23.4-win-x64;$env:Path";`
- Chrome 用户级 `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` 存在、Edge 存在 →
  Lighthouse 用 `CHROME_PATH` 指向 Chrome 跑
- 当前 dist：index-*.js 1,458 kB（gzip 431 kB）单 chunk；draco wasm/js 已随构建产出（未启用）
- human.glb 10,049,520 B（未压缩）；场景 JSON 53~199 KB
- SceneManager 已留 DRACOLoader 扩展点；poseMap/FK 对账只依赖节点变换（mesh 压缩不影响）
- 测试命令：web/ 下 `npx vitest run --pool=threads --fileParallelism=false`（109 绿）
- PowerShell 不支持 `&&`；Shell cwd 按需；git commit 不 push

## Task 1：Draco 压缩管线（<8MB 复验）

**Files**：`web/scripts/compress-glb.mjs`、`web/scripts/sync-assets.mjs`（接入）、
`web/src/three/SceneManager.ts`（启用 DRACOLoader）、package.json

- 依赖：dev 加 `@gltf-transform/cli`（或 core+functions 编程式 CLI 调用，选稳定方式）
- `compress-glb.mjs`：对 `pipeline/out/fullbody/human.glb` 做 gltf-transform optimize
  （draco 压缩 + 纹理不涉及）→ `web/public/data/models/human.glb`（直接产出压缩版替换
  sync 复制路径；原始未压缩 glb 保留在 pipeline/out 不动）；打印前后字节数
  - sync-assets 改为：复制 rig-meta/scenes/knowledge 照旧，glb 改由 compress-glb 产出
    （产物存在且比上次新则跳过，可强制刷新）
- SceneManager：启用 DRACOLoader（decoderPath 指向 vite 产出的 draco wasm 路径
  ——用 `import dracoWasmUrl from ...?url` 或复制 decoder 文件到 public/data/draco/，
  以实现简单稳定者为准）
- 验收：压缩后 glb < 8MB（预期 2~4MB）；`?fkcheck=1` 语义不变（节点变换不受 mesh
  压缩影响，但必须实测回归）；vitest 全绿；build 通过
- 文档留痕：05 文档 8MB 线复验结果（更新实现对齐小节的数据）
- commit `feat(P5): Draco 压缩管线接入与 8MB 线复验`

## Task 2：构建优化与断点对齐

**Files**：`web/vite.config.ts`（manualChunks + base './'）、`web/src/App.tsx`、`web/src/App.css`

- manualChunks：`three`（+依赖）/ `echarts` / `react-vendor`（react/react-dom/scheduler/zustand）
  三包拆分，目标主业务 chunk < 300KB gzip；记录分包前后各 chunk 体积
- `base: './'`：相对路径部署（任意子目录/静态服务器/U 盘可用——08 三通道前提）
- 断点 900px → 1024px（08 文档口径），MOBILE_QUERY 与 App.css media query 同步
- ECharts 动态 import（React.lazy 或 import() 于 ParamCharts 挂载前）可视收益决定
  （echarts 已模块化引入，若分包后主 chunk 达标则不做动态加载，避免加载闪屏——在汇报中给数据）
- 验收：build 产物 chunk 清单（体积+gzip 表）；vitest 全绿；preview 冒烟 200
- commit `feat(P5): 构建分包与相对路径部署基座`

## Task 3：Service Worker 预缓存

**Files**：`web/sw.js`（或 public/sw.js）、`web/src/main.tsx`（注册）、`web/public/manifest.webmanifest`（可选）

- 手写轻量 SW（不引 vite-plugin-pwa，避免重依赖）：
  - install：预缓存 App 骨架（index.html + 顶层 hashed assets——从构建清单读或 runtime 缓存）
  - fetch：App 骨架/静态资源 cache-first；`/data/` 大文件 stale-while-revalidate（模型/场景
    二次访问近离线）；index.html network-first（版本更新无停机）
  - activate：旧缓存清理（cache key 带版本号）
  - 仅 production 注册（import.meta.env.PROD），dev 不注册
- sw.js 放 public/（构建时原样拷贝；hashed 资源列表不能硬编码 → 用 runtime cache 策略为主，
  install 预缓存仅 `/` 与 `/data/models/rig-meta.json`）
- 离线验证说明：preview 下 DevTools offline 模拟人工验收（自动化环境无法可靠模拟，标注）
- commit `feat(P5): Service Worker 预缓存与更新策略`

## Task 4：Lighthouse 实测 + 部署配置 + 文档回填

**Files**：`web/lighthouserc.json`（可选）、`docs/modules/08-deployment-performance.md`、
`05-model-pipeline.md`、`01-3d-render-engine.md`、`00-overview.md`、`README.md`（根/或新建 web/README）

- Lighthouse：npm i -D lighthouse；`CHROME_PATH` 指向本机 Chrome；对
  `npm run preview` 地址跑移动端模拟（form-factor=mobile、4G throttling 默认预设）
  - 产出 Performance/Best Practices 分数与 FCP/LCP/TBT/CLS 指标，记录到 docs
  - **移动端 Lighthouse 对 WebGL 重应用的局限**：分数若 < 85，逐项列出机会
    （主因预期：JS 体积/主线程）——能修则修（Task 2 分包应已缓解），不能修的（真机差异）
    如实记录，最终真机验收列人工项
- 部署配置：不绑定平台，产出 `web/DEPLOY.md`（GitHub Pages workflow 示例 +
  Vercel 零配置说明 + 校内 Nginx/IIS 拷贝清单 + 离线整包说明），仓库不加 CI 配置
  （用户未要求远程仓库）
- 文档回填：
  - 08：标题 `[P5 已实现]` + 实现对齐（实际 chunk 体积表、SW 策略、Lighthouse 实测数字、
    人工验收清单：4 浏览器/真机/校内服务器/离线双击）
  - 05：Draco 复验结果（9.58MB → X MB，8MB 线结论）
  - 01：实现对齐补 Draco 已启用 + decoder 路径
  - 00：排期 P5 行标注（人工验收项注明）
- commit `feat(P5): Lighthouse 实测、部署文档与板块文档回填`

## Task 5：final review + 收尾

- final reviewer：逐验收要点判定（08 的 P5 清单 → 自动化可达 vs 人工项）；
  构建产物体积预算核对（首屏 < 5MB：index+js+css+rig-meta vs glb 懒加载口径）；
  全量回归（vitest/build/validate/fkcheck 语义）→ 归档本计划 → 收尾汇报

## 风险

| 风险 | 预案 |
|---|---|
| gltf-transform 压缩破坏节点名/层级 | fkcheck 对账 + glbNodes 测试锁定；若破坏改用 draco 参数细调 |
| DRACOLoader decoder 路径在 base './' 下解析错 | decoder 文件落 public/（相对路径天然正确）|
| Lighthouse 移动模拟对本地 WebGL 不公允 | 记录数字 + 列人工真机验收项，不硬凑分数 |
| SW 缓存旧版本资源 | cache key 版本化 + index.html network-first |
