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

**不采取的措施**：不做「把模型加载/图表初始化推迟到 TTI 之后」的改动——那只是把耗时挪出
Lighthouse 的统计窗口，真实用户等待时间不变，属于刷分而非优化。

### 4. 已知构建冗余

three r187 的 `DRACOLoader` 用 `new URL('../libs/draco/…', import.meta.url)` 静态引用解码器，
Vite 会把两套（`libs/draco` 与 `libs/draco/gltf`）解码器作为 `dist/assets/draco_*` 产出（约 1.33 MB）。
本项目的 `setDecoderPath('./draco/')` 指向 `public/draco/`，这些副本**永远不会被请求**，只占构建目录体积，
不进入首屏传输；如需极致瘦身可在后续用自定义构建插件剔除。

### 5. 部署通道（详见 `web/DEPLOY.md`）

- GitHub Pages（含 Actions 示例）、Vercel/静态托管、校内 Nginx/IIS（含 `data/`+`draco/`+`sw.js` 拷贝清单与
  缓存头/MIME 配置）、离线整包。
- **与设计的偏差（重要）**：「离线双击 `index.html` 可用」在当前实现下**不成立**——入口是
  `<script type="module">`，`file://` 下被 CORS 拦截；且 Service Worker 仅允许 https / localhost 注册。
  离线兜底改为「`dist/` + 本地静态服务器」（`python -m http.server` / `npx serve`），U 盘分发时附启动脚本。
  这一修正已同步写入 `web/DEPLOY.md` 第 5 节。

### 6. 人工验收清单（自动化不可达）

- [ ] Chrome / Safari / Edge / Firefox 最新版各走一遍三联动、分层控件、全屏图表、知识卡抽屉
- [ ] 手机 / 平板 / 桌面真机：模型加载、触控拾取、移动端 Tab 布局；记录真机 Lighthouse（预期高于本地 headless）
- [ ] 校内静态服务器（Nginx 或 IIS）部署一次：`glb` 为 `model/gltf-binary`、`wasm` 为 `application/wasm`
- [ ] 离线：本地静态服务器 + DevTools Offline 刷新，验证 SW 预缓存入口页与已访问场景
- [ ] 子目录部署（如 `/demo/`）验证资源与 SW scope 正确。
