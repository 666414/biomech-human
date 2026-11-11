# 上线前人工验收执行包（2026-11-08）

本包用于执行 P5 剩余 3 项**只能在真实环境完成**的验收（真机 / Safari / 知识卡专家终审；
校内服务器部署项已按 2026-11-08 决定取消，见 §3）。每项给出「前置 → 步骤 → 判据 → 记录 → 失败排查」，
执行完把结论回填到 `docs/modules/08-deployment-performance.md` §6 与 `docs/modules/00-overview.md` 排期表 P5 行。

## 0. 包内材料

| 材料 | 路径 | 说明 |
|---|---|---|
| 部署产物 | `release/biomech-web-dist-2026-11-08.zip`（1.5 MB，23 个条目） | 解压即站点根内容：`index.html` + `assets/` + `data/` + `draco/` + `sw.js`；已校验与 `web/dist` 逐文件 SHA-256 一致（23/23） |
| 部署指南 | `web/DEPLOY.md` | Nginx/IIS 配置、MIME、缓存头、SW 策略 |
| 已完成的自动化证据 | `docs/modules/08-deployment-performance.md` §6 | Chrome/Edge/Firefox 走查、离线、子路径部署、移动端模拟 |
| 知识卡与 AI 预审 | `content/knowledge/knowledge.json`、`content/knowledge/REVIEW.md` | 41 张卡；预审已修订 6 处、新增 1 卡 |
| 视觉基线截图 | `docs/reports/shots/01~16-*.png` | 真机/浏览器对照用 |

PC 端快速自检（任何页面，控制台执行）：

```js
JSON.parse(document.querySelector('[data-debug]').getAttribute('data-debug'))
// 期望：{ modelLoaded: true, bodyCount: 81, layerMeshes: {skeleton:132, muscle:8, skin:1}, ... }
```

## 1. 真机验收（手机 / 平板 / 桌面）

**前置**：站点已部署到 **https**——**已就绪（2026-11-11）**：https://666414.github.io/biomech-human/ （GitHub Pages，已通过线上自动验收）。
注意：`http://<局域网 IP>` **不是安全上下文，Service Worker 不会注册**，离线能力无法在局域网 http 下验收。

**设备矩阵（建议）**：iPhone（Safari）、Android 手机（Chrome）、iPad（Safari）、桌面 1440p 以上（Chrome/Edge）。

**步骤与判据**：

| # | 操作 | 判据 |
|---|---|---|
| 1 | 首次打开 | 全屏加载态显示进度，≤ 10 s 进入；3D 人体可见（骨骼+半透明皮肤） |
| 2 | 分层开关 | 依次关/开 骨骼、肌肉、皮肤，画面确有变化，无闪烁报错 |
| 3 | 触控点选 | 轻点模型躯干/四肢，出现部位中英文角标；拖动旋转不误触选部位 |
| 4 | 时间轴 | 播放/暂停、拖动游标，3D 姿态与曲线游标同步 |
| 5 | 场景切换 | 5 个场景逐个切换均能加载（gait_cycle / drop_landing / lift_task / shoulder_abduction / ankle_inversion） |
| 6 | 移动端 Tab | 手机/平板出现 3D / 曲线 / 知识 三 Tab；切换后回 3D 不重新加载模型 |
| 7 | 知识卡 | 选中部位后「知识」Tab 显示对应卡；卡内「定位」能聚焦部位 |
| 8 | 离线复访 | 首次在线访问后断网刷新（或飞行模式），仍能进入页面并加载已访问场景 |
| 9 | 真机 Lighthouse | Chrome 移动端跑一次，记录 Performance/FCP/LCP/TBT/CLS（预期高于本地 headless 的 83） |

**记录表**：

| 设备 / 系统 / 浏览器版本 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 首屏耗时 | Lighthouse |
|---|---|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |  |  |

**失败排查**：先看控制台错误 + `data-debug` 的 `lastError` / `attempts`；模型 404 查托管平台的 MIME 配置
（`web/DEPLOY.md` §4）；弱机卡顿可加 `?quality=low`（或 `?lite=1`）复测，用于区分「设备性能」与「实现缺陷」。

## 2. Safari（macOS / iOS）专项

Windows 无 Safari，必须在此项补测。重点不是功能，而是 **WebKit 的 WebGL 与材质差异**。

**步骤**：Safari → 开发菜单 → 响应式设计模式（iPhone 15 / iPad）逐个尺寸；另在桌面 Safari 正常模式看一次。

**判据**：

| # | 关注点 | 判据 |
|---|---|---|
| 1 | 模型可加载 | 控制台 `data-debug.modelLoaded === true`，`bodyCount === 81` |
| 2 | 肌肉质感 | 与 [03-muscle-only.png](shots/03-muscle-only.png) 对照：管体高光、sheen、描边、透明度层次基本一致（允许色调细微差异，不允许发黑/全白/无光照） |
| 3 | 皮肤半透明 | 与 [01-default.png](shots/01-default.png) 对照：皮肤呈半透明外壳，骨骼可透见 |
| 4 | 交互 | 双指缩放/单指旋转正常，点选部位正常 |
| 5 | 移动端布局 | 三 Tab + 底部时间轴正常，无横向滚动条 |
| 6 | SW | iOS 16.4+ / macOS Safari 16.4+ 下 `sw.js` 注册成功（应用 → 服务工作者） |

**记录**：Safari 版本 / 设备、2~4 项结论、异常截图存 `docs/reports/shots/`（命名 `safari-*.png`）。

**已知风险**：WebKit 对 `MeshPhysicalMaterial` 的 `clearcoat/sheen` 计算与 Chromium 不完全一致，
若出现明显偏差，按截图记录后交回工程侧调材质参数（不改验收口径）。

## 3. 校内静态服务器部署（已取消）

**2026-11-08 决定：取消该项**，不再部署校内 Nginx/IIS 服务器，发布走 GitHub Pages / Vercel / 任意静态托管
（`web/DEPLOY.md` 三通道说明保持有效）。原人工验收要求随之关闭。

作为留档：交付包 zip 在本地按 DEPLOY.md §4 口径（`/biomech/` 子路径 + MIME/缓存头）演练已通过——
`.glb/.wasm/sw.js/rig-meta` 四点 200 且 MIME 正确、首屏 `bodyCount:81`、SW `active` scope 正确、
`?fkcheck=1` 最大位置差 1.085e-7 m（截图 [17-zip-deploy.png](shots/17-zip-deploy.png)）。
若日后改主意要自建服务器，按 `web/DEPLOY.md` §4 配置即可，产物本身已被证明无部署形态缺陷。

## 4. 知识卡医学专家终审（41 张）

**材料**：`content/knowledge/REVIEW.md`（含逐卡结论表、修订记录、4 项遗留存疑）、应用内「知识」面板。

**步骤**：

1. 专家先读 `REVIEW.md` 一、二、三节，了解审查口径与已修订项（6 处修订 + 1 张新增卡）。
2. 在应用内逐卡查看（三个入口：关键帧弹卡、部位点选、曲线系列点击），重点核对解剖术语与机制表述。
3. 重点确认 4 项存疑：
   - 步态场景 `subtalar_angle_r` 恒为 0°，但卡文按教科书口径描述距下外翻 5°~10°（卡未声称读数来自模型）；
   - 肩保持帧实测外展 88°，卡文按「90° 保持段」标称口径；
   - 卡内激活读数为模型「相对读数」，非实测 EMG %MVC；
   - `kf-sh-90` 中「三角肌三束激活随外展角上升」为总体趋势表述（DELT3 中后段呈平台约 50）。
4. 需修订的卡：记录 `cardId` + 章节（anatomy/biomech/clinic/refs）+ 修改意见，交工程侧改 `knowledge.json` 后重跑
   `npm run validate:knowledge` 与 `npm run sync-assets`。

**签署页（回填 `REVIEW.md` 末尾）**：

| 项目 | 内容 |
|---|---|
| 审阅人 / 单位 / 职称 |  |
| 审阅日期 |  |
| 覆盖范围 | 41 张卡（10 关键帧 + 14 部位 + 17 肌肉） |
| 结论 | □ 全部通过　□ 通过但需修订（附清单）　□ 不通过 |
| 修改清单（cardId / 章节 / 意见） |  |
| 签字 |  |

## 5. 关闭标准与回填

3 项全部完成后：

1. `docs/modules/08-deployment-performance.md` §6：把「真机」由 `[~]` 改 `[x]` 并补实测数字，
   Safari 项补版本与结论、删除「待补测」表述（校内服务器项已按取消决定关闭）。
2. `docs/modules/00-overview.md` 排期表 P5 行：把人工验收待执行表述改为已完成（注明校内服务器项取消）。
3. 若过程中发现缺陷：按问题类型回到 01（渲染）/02（交互）/03（图表）/08（部署）对应文档记录根因与修复，
   不直接改验收口径。
