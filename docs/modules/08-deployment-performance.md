# 08 部署与性能优化 `[P5 已实现]`

## 核心定位

保障「任意用户通过标准网络环境直接访问」的交付板块：覆盖构建产物托管、多端自适应、性能预算与离线缓存。

## 设计目标

1. 部署零依赖：产物为纯静态文件，任意静态托管/校内服务器/U盘离线均可运行。
2. 性能预算：首屏 < 5MB、4G 下首屏加载 < 3s、Lighthouse 移动端 ≥ 85。
3. 全设备可用：手机/平板/桌面响应式，低端机自动降质。

## 实现逻辑

**部署方案（三通道）**
- 首选：GitHub Pages / Vercel（免费、HTTPS、全球 CDN）。
- 校内网：静态文件直接拷入学校 Web 服务器（Nginx/IIS），无任何运行时依赖。
- 兜底：整包离线分发，双击 `index.html` 可用（依赖 Service Worker 预缓存）。
- 版本策略：Vite 产物带 content hash，更新即发布，无停机。

**性能优化清单**
- 传输：Draco 压缩模型 + brotli/gzip + 场景 JSON 懒加载（进入场景页才拉取）。
- 渲染：合并静态网格减少 draw call；`renderer.setPixelRatio` 上限 2；按 `navigator.hardwareConcurrency` 判定低端机 → 降质预设（减面 LOD、关阴影）。
- 图表：LTTB 降采样 + ECharts dataZoom（03 板块细则）。
- 缓存：Service Worker 预缓存骨架与当前场景，二次访问近离线可用。

**响应式布局**
- 桌面：左 3D 视口（约 65%）+ 右侧上下分栏（曲线 / 知识卡）。
- 移动：3D 全宽置顶，下方 Tab「参数 / 讲解」，曲线可全屏展开。
- 断点：≥1024px 桌面布局；< 1024px 移动布局。

## 关键依赖

- 构建链：Vite（hash、压缩、分包）。
- 08 依赖各板块的性能预算承诺：01（模型 < 8MB）、06（场景 < 2MB）。
- 部署平台：GitHub Pages / Vercel / 校内服务器任选其一。

## 边界范围

- **包含**：托管配置、构建优化、缓存策略、响应式断点与降质策略、性能验收。
- **不包含**：各功能模块内部实现（见 01~04）、数据生产（05~07）、后端服务（系统无后端）。

## 核心流程说明

```
[首次访问]
  → CDN 拉取 SPA 骨架（< 5MB 预算内）
  → Service Worker 注册预缓存
  → 首页加载基础模型元数据
[进入某场景]
  → 懒加载 human.glb + scenes/<scene>.json
  → 低端机？→ 启用降质预设
[版本更新]
  → 新 hash 资源发布 → SW 增量更新 → 无停机
```

## 验收要点（P5）

- Lighthouse 移动端 ≥ 85；4G 模拟首屏 < 3s。
- Chrome/Safari/Edge/Firefox 最新版手动通过；手机/平板/桌面真机通过。
- 校内静态服务器与离线双击两种兜底方式各验证一次。

## 实现对齐 `[P5 已实现]`

### 1. 构建产物与分包（实测）

`vite.config.ts`：`base: './'` + `manualChunks` 拆 `three` / `echarts` / `react-vendor`。
分包前单 chunk `index` 1,458 kB（gzip 431 kB）→ 分包后：

| chunk | 原始 | gzip |
|---|---|---|
| `index`（业务） | 34.6 kB | 12.7 kB |
| `react-vendor` | 219.3 kB | 68.5 kB |
| `echarts` | 559.2 kB | 188.7 kB |
| `three` | 645.7 kB | 161.2 kB |
| `index.css` | 8.7 kB | 2.3 kB |

业务代码改动不再使三个大依赖的缓存失效；首屏（骨架 + rig-meta，不含懒加载的 glb/场景/解码器）
约 1.5 MB 未压缩 / 0.45 MB gzip，满足「首屏 < 5MB」预算。

### 2. 传输与缓存

- **Draco**：模型 10,049,520 B → 646,860 B（-93.6%），解码器落 `web/public/draco/`（详见 05）。
- **Service Worker**（`web/public/sw.js`，仅生产注册）：导航 network-first（失败回落缓存入口页）；
  `data/`（glb/场景/rig-meta）stale-while-revalidate；`assets/`、`draco/`、favicon cache-first。
  缓存 key `CACHE_VERSION = 'p5-skeleton-v1'`，activate 删旧代 + `clients.claim()`。
  分类逻辑抽为纯函数 `web/src/sw/policy.ts`（33 条 vitest 用例），`public/sw.js` 内嵌等价实现并由
  测试对原文做逐行锚定断言，防两侧漂移。部署根从 `registration.scope` 推导，子目录部署同样正确。
- **相对路径**：`base: './'` + 注册 `./sw.js`，产物可部署在任意子目录（如 `/demo/`），无需改配置。

### 3. Lighthouse 移动端实测（本机 Chrome headless，2026-11）

命令：`npx lighthouse http://127.0.0.1:4173/ --output=json --chrome-flags="--headless=new --no-sandbox"`，
使用 Lighthouse 默认移动端预设（Moto G Power 视口 + 4× CPU 节流 + 慢 4G 模拟节流）。

| 指标 | 结果 |
|---|---|
| FCP / LCP | 0.8 s / 0.8~1.0 s（达标：< 3 s） |
| CLS | 0.001 |
| Speed Index | 1.7~2.6 s |
| TBT | 0.5~3.8 s（波动大，见下） |
| TTI | 3.7~11.9 s |
| Accessibility / Best Practices / SEO | 96 / 100 / 91 |
| 总传输字节 | 1,087 KiB |

**Performance 分数**：启用 GPU 后端（`--use-angle=d3d11`）三轮为 **83 / 77 / 83**；默认软件光栅
（`--disable-gpu`）八轮为 86 / 84 / 84 / 81 / 73 / 72 / 71 / 70（中位 81）。

**结论与差距分析**：FCP/LCP/CLS 全部远优于预算，唯一失分项是 TBT，因此分数在 70~86 间摆动。
主因按可能性排序：

1. **headless 渲染环境**：无 GPU 时 Chrome 走 SwiftShader 软件光栅，700 块肌肉 + 80 骨骼的
   逐帧 WebGL 提交严重放大主线程耗时（`mainthread-work-breakdown` 中 Other 项达 5.5 s，同一页面
   启用 D3D11 后同轮降至 0.9 s）。此项在本机无法消除：**真机（尤其带 GPU 的手机/平板）预期显著高于此值**，
   列为人工验收项。
2. **机器负载抖动**：同一命令连续多轮的 TBT 从 530 ms 到 3.8 s，说明测量本身受宿主负载影响大，
   单次分数不足以判定不达标。
3. **未使用代码**：`unused-javascript` 报告约 253 KiB（echarts 154.5 / three 70.8 / react-vendor 34.0）。
   echarts 已按 `echarts/core` 模块化引入，剩余为图表类型注册开销；three 的未用部分主要来自
   addons（DRACOLoader/OrbitControls）内部依赖，二者均无低风险的进一步削减手段，
   沿用「分包 + 懒加载数据」策略即可。

**按需渲染优化（2026-11-06 已实施）**：板块 01 的 RAF 循环改为按需渲染（`needsRender`
脏标记 + 姿态值缓存，见板块 01「按需渲染」），空闲帧不再提交 WebGL。同机同口径复测
（3 次取整）：

| 配置 | Performance | TBT | work-breakdown 首位 |
| --- | --- | --- | --- |
| `--use-angle=d3d11` | 75 / 76 / 76 | 1.2–1.9s | scriptEvaluation ≈2.7s，**Other 降至 ≈0.5s** |
| 软光栅 | 72 / 76 / 72 | 1.5–1.9s | 同上 |

- 结论：上述假设 1 被证实并消除——`Other` 从 5.5s 降至 0.5s（-90%），TBT 波动带从
  0.5–3.8s 收敛到 1.2–1.9s。新的 TBT 地板是 `scriptEvaluation ≈2.7s`（Moto G4 模拟 4×
  减速下 three/echarts/启动逻辑的解析执行，对应真机约 0.7s），属于加载必要脚本，
  与下方「不推迟加载刷分」的立场一致，不再下探。
- 功能回归：vitest 156 全绿；headless 浏览器实测图层切换/播放/肌肉显示正常、无控制台错误。
- 本机分数（75±1）低于此前记录的 83 属机器负载差（TBT 区间重叠），结构性收益以上表为准；
  **最终验收仍归真机项**（§6 人工验收清单 ②），真机 GPU + 空闲零渲染开销，预期改善显著。

**不采取的措施**：不做「把模型加载/图表初始化推迟到 TTI 之后」的改动——那只是把耗时挪出
Lighthouse 的统计窗口，真实用户等待时间不变，属于刷分而非优化。

### 4. 构建冗余已剔除

three r187 的 `DRACOLoader` 在模块级用 `new URL('../libs/draco/…', import.meta.url)` 静态引用解码器，
Vite 会把两套（`libs/draco` 与 `libs/draco/gltf`）解码器作为 `dist/assets/draco_*` 产出
（4 个文件、约 1.0 MB）。本项目的 `setDecoderPath('./draco/')` 指向 `public/draco/`，
这些副本**永远不会被请求**，只占构建目录体积。

已在 `web/vite.config.ts` 增加构建插件 `drop-emitted-draco-decoders`（`generateBundle` 阶段从产物中
删除 `assets/draco_(decoder|wasm_wrapper)-*`）。验证：

- 产物 `dist/assets/` 已无 `draco_*`，`dist/draco/` 三件套完整（512 kB js + 192 kB wasm + 58 kB wrapper）
- 构建总字节 3,577,767 B（约 3.58 MB），较剔除前少约 1.0 MB
- 浏览器实测（`?fkcheck=1`）：`data-debug` 中 `modelLoaded=true`、`bodyCount=80`，控制台无 draco 解码 404
- 依据：`setDecoderPath('./draco/')` 会同时覆盖 js / wasm / dep_js 三条路径（three r187 `DRACOLoader` 源码），
  模块级默认 URL 仅在未显式设置路径时才生效

### 5. 部署通道（详见 `web/DEPLOY.md`）

- **已上线（2026-11-11）：https://666414.github.io/biomech-human/**（仓库 `666414/biomech-human`，Pages 源 = `gh-pages`
  分支根，本地构建直推）。线上验收通过：`.glb` 200 / `model/gltf-binary`、`.wasm` 200 / `application/wasm`、
  `modelLoaded:true`、`bodyCount:81`、`layerMeshes 132/8/1`、SW `active`（scope = `.../biomech-human/`）、0 控制台错误。
  截图：[18-live-github-pages.png](shots/18-live-github-pages.png)。真机 / Safari 验收可直接用该地址。

- GitHub Pages（含 Actions 示例）、Vercel/静态托管、校内 Nginx/IIS（含 `data/`+`draco/`+`sw.js` 拷贝清单与
  缓存头/MIME 配置）、离线整包。
- **与设计的偏差（重要）**：「离线双击 `index.html` 可用」在当前实现下**不成立**——入口是
  `<script type="module">`，`file://` 下被 CORS 拦截；且 Service Worker 仅允许 https / localhost 注册。
  离线兜底改为「`dist/` + 本地静态服务器」（`python -m http.server` / `npx serve`），U 盘分发时附启动脚本。
  这一修正已同步写入 `web/DEPLOY.md` 第 5 节。

### 6. 人工验收清单（自动化不可达）

> 执行材料与判据见 [上线前人工验收执行包](../reports/2026-11-08-manual-acceptance-package.md)：
> 含部署产物（`release/biomech-web-dist-2026-11-08.zip`）、逐项步骤/判据/记录表、服务器侧 HTTP 自检命令。

- [~] 浏览器走查：**Chrome / Edge / Firefox 已通过自动化走查（2026-11-08）**，Safari 待 macOS/iOS 人工补测。
  - 口径：`vite preview` 产物包 + puppeteer-core 驱动，各浏览器独立跑一遍
    加载 → 皮肤/肌肉/骨骼三开关（关闭/恢复均比对画布像素）→ 播放 2 s → 截图。
  - 实测（三者同一断言全绿）：

    | 浏览器 | 版本 | 模型加载 | bodyCount | layerMeshes | 三开关画面变化 | 播放帧推进 | 控制台错误 |
    | --- | --- | --- | --- | --- | --- | --- | --- |
    | Chrome | 本机稳定版 | ✅ 2.2 s | 81 | 132 / 8 / 1 | 3/3 | +18 帧 | 0 |
    | Edge | 本机稳定版 | ✅ 2.3 s | 81 | 132 / 8 / 1 | 3/3 | +14 帧 | 0 |
    | Firefox | 137.0.1 | ✅ 3.7 s | 81 | 132 / 8 / 1 | 3/3 | +287 帧 | 0 |

  - 说明：bodyCount 81 = 80 rig body + 1 皮肤节点（`skin_mesh`），与当前资产一致；
    Firefox 走 WebDriver BiDi，`setViewport` 不受支持（改用窗口参数），元素截图受限时回退整页截图。
  - 截图：[browser-chrome.png](shots/browser-chrome.png) / [browser-edge.png](shots/browser-edge.png) /
    [browser-firefox.png](shots/browser-firefox.png)。
  - **Safari 在本机（Windows）无法覆盖**：无 Windows 版 Safari，webkit 引擎差异（尤其 WebGL 精度、
    `MeshPhysicalMaterial` 的 clearcoat/sheen）必须在 macOS 或 iOS 真机上补测，仍为未关闭项。
- [~] 手机 / 平板 / 桌面真机：**移动端布局与触控已用 Chrome 设备模拟（390×844 / DPR 3 / touch / 移动 UA）通过（2026-11-08）**，
  真机（iOS/Android 实机、平板、真机 Lighthouse）仍需人工执行。
  - 实测：自动降质生效（宽 < 768 走 low 档）、模型 `modelLoaded:true`、`bodyCount:81`、
    外壳为三 Tab（3D/曲线/知识，默认 3D）、底部时间轴常驻；触控点选命中 `pelvis`（部位卡出现）。
  - Tab 切换：曲线（`.app-charts-tab` 渲染、视口 `slot-hidden` 但 canvas 尺寸保留）→ 知识（选中部位卡非空态）
    → 回 3D（视口恢复、`modelLoaded` 仍为 true，WebGL 上下文未重建）；播放 2 s 渲染帧 567→893；控制台错误 0。
  - 截图：[13-mobile-3d.png](shots/13-mobile-3d.png) / [14-mobile-picked.png](shots/14-mobile-picked.png) /
    [15-mobile-charts.png](shots/15-mobile-charts.png) / [16-mobile-knowledge.png](shots/16-mobile-knowledge.png)。
  - 说明：模拟覆盖不到真机 GPU 性能、iOS Safari 引擎差异与真实触感区，不能替代真机项。
- [x] 校内静态服务器（Nginx 或 IIS）部署一次：**已取消（2026-11-08 用户决定）**，发布走 GitHub Pages /
  Vercel / 任意静态托管。关闭前部署形态已在本地静态服务器演练通过（`/biomech/` 与 `/` 双基座，
  MIME / 缓存头 / SW scope / fkcheck 全绿，交付包 zip 与 `dist` 逐文件 SHA-256 一致），
  产物本身无部署形态缺陷；`web/DEPLOY.md` §4 的 Nginx/IIS 配置说明保留备用。
  - 口径：Node http 服务把 `dist/` 挂到子路径，按 `DEPLOY.md` 的 MIME / 缓存头口径托管，
    puppeteer 驱动 Chromium 验收；`.glb → model/gltf-binary`、`.wasm → application/wasm`、`sw.js → no-cache` 均命中。
  - 结果见下方「子目录部署」条目。
- [x] 离线：✅ 已验证（2026-11-06，headless Edge + CDP `Network.emulateNetworkConditions offline`）——
  `vite preview` 在线加载（SW `activated`）后切离线刷新，`data-debug` 实测
  `modelLoaded:true, bodyCount:81, layerMeshes {skeleton:132, muscle:8, skin:1}`，无 console/pageerror；
  证明 SW 预缓存覆盖入口页、glb、Draco wasm 与已访问场景 JSON。
  （真机 DevTools Offline 复验可与真机项一并进行，非阻塞）
  **线上复验（2026-11-11，GitHub Pages）**：首访（全新 profile）→ 5 场景逐个切换 → CDP 离线刷新，
  `modelLoaded:true`、0 失败请求。期间发现并修复真实缺陷「首访即离线白屏」：首屏 hashed 资源与 glb
  在 SW 接管前加载完、从未入缓存——修复为 glb 预缓存（`p5-skeleton-v3`）+ 页面 postMessage 资源回填，
  见 `web/DEPLOY.md` §6。同场实测：5 场景切换全绿、`?fkcheck=1` 最大位置差 1.085e-7 m、控制台错误 0。
- [x] 子目录部署（如 `/demo/`）验证资源与 SW scope 正确：✅ 已验证（2026-11-08，`/biomech/` 与 `/` 双基座）
  - `/biomech/`：数据请求越界 0、模型 4348 ms、`bodyCount:81`、`layerMeshes 132/8/1`、
    SW scope `http://localhost:8099/biomech/`、控制台错误 0；`/` 回归同样通过（4459 ms）。
  - 首跑暴露真实缺陷：`data.ts` / `Viewport.tsx` / `fkCheck.ts` 写死 `/data/...` 站点根路径，
    子路径下 4 个数据请求 404、`modelLoaded:false`（92 s）。已统一改为 `assetUrl()` 拼 `BASE_URL`，
    并在 `web/DEPLOY.md` §4 写入「新增数据请求必须走 `assetUrl()`」的约定。
  - 截图：`docs/reports/shots/deploy-subpath.png`。
