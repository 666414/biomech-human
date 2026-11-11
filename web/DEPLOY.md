# 部署指南（web 静态产物）

本系统运行期无后端：`web/dist/` 是纯静态文件，可托管在任意静态服务器上。
`vite.config.ts` 已设 `base: './'`，产物用相对路径引用，因此**可部署在域名根目录，也可部署在任意子目录**（如 `/demo/`、`/teaching/biomech/`）。

## 1. 构建

需要 Node.js ≥ 20（本项目实测 22.23.4）。**注意**：`web/public/data/` 与 `web/public/draco/` 为派生目录（已 gitignore），
干净克隆的仓库必须先跑资源同步，否则构建产物缺模型/场景/知识库。

```powershell
# ① 若 pipeline/out 尚无产物，先在仓库根跑流水线（需 Python + MuJoCo，仅开发期一次）
.venv\Scripts\python.exe -m pipeline.run_all        # 或按 pipeline/README 逐场景运行

# ② 同步资源 + 构建
cd web
npm ci
npm run sync-assets      # 知识库校验门 + Draco 压缩 glb + 复制 rig-meta/scenes + draco 解码器
npm run build            # tsc -b && vite build → web/dist
```

`npm run sync-assets` 的失败语义：知识库校验不通过直接 `exit 1`（防脏数据上线）；
`pipeline/out` 缺失时对应资源 `[skip]`，构建仍可完成但页面无模型可用。

产物结构（P5 实测）：

| 文件 | 体积 | gzip | 说明 |
|---|---|---|---|
| `assets/index-*.js` | 40.6 kB | 14.8 kB | 业务代码 |
| `assets/ParamCharts-*.js` | 5.7 kB | 2.5 kB | 曲线图组件（懒加载，随 echarts chunk 按需拉取） |
| `assets/react-vendor-*.js` | 219.3 kB | 68.5 kB | react/react-dom/scheduler/zustand |
| `assets/echarts-*.js` | 559.2 kB | 188.7 kB | echarts + zrender（**懒加载**：首帧后按需，移动端首屏不加载） |
| `assets/three-*.js` | 645.7 kB | 161.2 kB | three.js |
| `assets/index-*.css` | 8.7 kB | 2.3 kB | 样式 |
| `sw.js` | 6.2 kB | — | Service Worker（不 hash，须 no-cache 托管） |
| `data/models/human.glb` | 646.9 kB | — | Draco 压缩模型（懒加载） |
| `data/models/rig-meta.json` | 35.7 kB | — | 部位名表（首屏需要） |
| `data/scenes/*.json` | 53~195 kB | — | 5 个场景，选中后懒加载 |
| `draco/draco_decoder.wasm` + js | 192.4 + 512.5 kB | — | 解码器，首次加载模型时请求 |

首屏（骨架 + rig-meta，不含模型/场景/解码器）≈ 1.5 MB 未压缩 / 约 0.45 MB gzip。

## 2. 通道一：GitHub Pages

> **已上线（2026-11-11）**：https://666414.github.io/biomech-human/ （仓库 `666414/biomech-human`，Pages 源 = `gh-pages` 分支根）。
> 实际采用「本地构建 → 直推 `gh-pages` 孤立分支」方式（因 `sync-assets` 依赖未入库的 `pipeline/out`，CI 构建不可用）；
> 推送与 Pages 启用均验证通过：`.glb` MIME 正确、`bodyCount:81`、`layerMeshes 132/8/1`、SW `active`（scope = 站点子路径）、0 控制台错误。
> 更新流程：本地 `npm run build` 后，把 `dist/` 内容提交到 `gh-pages` 分支推送即可（保留 `.nojekyll`）。

仓库设置 → Pages → Source 选「GitHub Actions」，然后加入工作流（示例，按需调整路径）：

```yaml
# .github/workflows/deploy.yml
name: deploy
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
        working-directory: web
      - run: npm run sync-assets
        working-directory: web
      - run: npm run build
        working-directory: web
      - uses: actions/upload-pages-artifact@v3
        with:
          path: web/dist
  deploy:
    needs: build
    permissions: { pages: write, id-token: write }
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/deploy-pages@v4
```

**限制**：`sync-assets` 依赖仓库根的 `pipeline/out/`，而该目录被 gitignore（需 Python + MuJoCo 才能生成）。
CI 中要么先把产物提交进仓库（见下节「产物入库」），要么改为「本地构建后只发布 `web/dist`」。

## 3. 通道二：Vercel / 任意静态托管

- Vercel：Framework 选 Vite，Root Directory 填 `web`，Build Command `npm run build`，Output `dist`。
  同样受上面的「产物需预先存在」限制；最省事的做法是本地 `npm run build` 后用 `vercel deploy --prebuilt` 或直接上传 `dist/`。
- Netlify/OSS/CDN 同理：上传目录选 `web/dist`，无需任何服务端重写规则（SPA 只有单一入口）。

## 4. 通道三：校内静态服务器（Nginx / IIS）

把 `web/dist/` 下**全部内容**（含 `data/`、`draco/`、`sw.js`）拷到站点目录即可，无运行时依赖。

**数据请求必须走基座**：代码里取静态数据一律用 `assetUrl('/data/...')`（`src/data.ts`），
它拼 `import.meta.env.BASE_URL`，子目录部署时请求会落到 `<子目录>/data/...`。
**禁止**写死 `'/data/...'` 这类站点根绝对路径——即使 `base: './'` 正确，写死根路径的资源在子目录下也会 404
（P5 实测踩坑，见 §7 验证记录）。新增数据文件时同样遵守此约定。

Nginx 参考配置：

```nginx
server {
  listen 80;
  server_name biomech.example.edu;
  root /var/www/biomech;      # web/dist 内容
  index index.html;

  # SPA 兜底（当前应用无路由，但保留以防深链接）
  location / {
    try_files $uri $uri/ /index.html;
  }

  # hashed 产物可长缓存；sw.js 与 data/ 必须回源校验
  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
  location = /sw.js {
    add_header Cache-Control "no-cache";
  }
  location /data/ {
    add_header Cache-Control "no-cache";
  }

  # 确保扩展名 MIME 正确（部分老版本 Nginx 未内置）
  types {
    model/gltf-binary glb;
    application/wasm    wasm;
    application/json    json;
  }
}
```

IIS：把 `web/dist` 设为站点物理路径，添加 MIME 映射 `.glb → model/gltf-binary`、`.wasm → application/wasm`，
并为 `sw.js` 设置 `Cache-Control: no-cache`（HTTP 响应头模块）。

## 5. 离线与「双击打开」的真实边界

`sw.js` 只在 **https 或 localhost** 下可注册（浏览器安全策略），且 `index.html` 通过 `<script type="module">`
加载，`file://` 协议下会被 CORS 拦截。因此：

- ❌ **直接双击 `dist/index.html` 不可用**（白屏）。这与 08 设计稿中「双击可用」的设想不符，属于实现期修正，
  已在 `docs/modules/08-deployment-performance.md` 的实现对齐中记录。
- ✅ 离线兜底方式：在 `dist/` 目录起一个本地静态服务器后访问 localhost（Service Worker 可正常注册）：

```powershell
# 任选其一
python -m http.server 8000 --directory dist
npx serve dist
```

U 盘分发时附一行启动命令（或打包一个 `start.cmd` 写入上述命令）即可在无网环境使用。

## 6. Service Worker 与版本更新

- 仅生产构建注册（`src/main.tsx` 中 `import.meta.env.PROD`），开发服务器不注册、不缓存。
- 策略：导航 network-first（失败回落缓存入口页）；`data/` stale-while-revalidate（二次访问近离线）；
  `assets/`、`draco/`、favicon 等 cache-first。判定逻辑见 `src/sw/policy.ts`（有 vitest 全量覆盖）。
- **首访即离线**（v3）：glb 在 SW 接管前就开始加载（注册挂在 window load 之后），fetch 拦截不到，
  故 `human.glb` 直接进预缓存清单；其余同源资源由页面在 SW ready 后把
  `performance.getEntriesByType('resource')` 的 URL `postMessage` 给 SW 回填（`sw.js` 底部 message 监听）。
  没有这套机制时，首访后立即离线会白屏（首屏 hashed 资源不在缓存）——GitHub Pages 实测踩坑后修复。
- 缓存版本号 `CACHE_VERSION` 在 `public/sw.js` 手工维护：**预缓存清单或策略变化时递增**，
  activate 阶段会删掉旧代缓存完成整池换代；hashed 资源改名即自动失效，无需递增。
- 首次部署后建议在 DevTools → Application → Service Workers 勾选 Update on reload 验证；
  离线验收：切到 Offline 后刷新应仍能进入页面并加载已缓存场景（GitHub Pages 线上实测通过，含首访即离线）。

## 7. 部署后验收清单

> **线上已验证（2026-11-11，https://666414.github.io/biomech-human/ ）**：6 条全部通过——
> glb/wasm MIME 正确、5 场景切换与三联动正常、SW `activated`（scope = 站点子路径）、
> 子路径部署正常、`?fkcheck=1` 误差 1.085e-7 m。首次部署到新地址时可按此清单复跑。

- [ ] 首屏能看到 3D 模型，`data/models/human.glb` 返回 200 且 MIME 为 `model/gltf-binary`
- [ ] `draco/draco_decoder.wasm` 返回 200 且 MIME 为 `application/wasm`（否则解码器回退 JS，仍可加载但更慢）
- [ ] 场景切换（5 个）、曲线游标、知识卡三联动正常
- [ ] `sw.js` 返回 200（https/localhost），DevTools 中 SW 状态为 activated
- [ ] 部署在子目录（如 `/demo/`）时资源与 SW 均正常（scope 从注册路径自动推导）
- [ ] `?fkcheck=1` 控制台输出 FK 对账误差仍为 1e-7 量级（验证 Draco 压缩未破坏姿态映射）

### 部署形态演练记录（2026-11-08，本地静态服务器复现）

用 Node http 服务把 `dist/` 挂到子路径并按本文 MIME / 缓存头口径托管，puppeteer 驱动 Chromium 验收：

| 基座 | 数据请求越界 | 模型加载 | bodyCount | layerMeshes | SW scope | 控制台错误 |
|---|---|---|---|---|---|---|
| `/biomech/` | 0 | 4348 ms | 81 | 132 / 8 / 1 | `http://localhost:8099/biomech/` | 0 |
| `/`（回归） | 0 | 4459 ms | 81 | 132 / 8 / 1 | `http://localhost:8099/` | 0 |

- 上述「首屏模型 / MIME / SW / 子目录」四条在演练中均通过（`.glb → model/gltf-binary`、
  `.wasm → application/wasm`、`sw.js → no-cache`）。
- 子路径首跑为失败：`/data/models/human.glb` 等 4 个请求越出前缀 404、92 s 后 `modelLoaded:false`；
  根因是 `data.ts` / `Viewport.tsx` / `fkCheck.ts` 写死站点根路径，已统一改为 `assetUrl()`（见 §4）。
  截图：[deploy-subpath.png](../docs/reports/shots/deploy-subpath.png)
- **仍未覆盖**：校内真实服务器（Nginx/IIS 实际配置、HTTPS 证书下的 SW 注册）与真机（手机/平板）——
  这两项需在实际环境人工执行，演练只证明产物自身的部署形态无缺陷。

