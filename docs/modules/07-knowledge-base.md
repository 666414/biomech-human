# 07 知识库内容管理 `[P4 已实现]`

## 核心定位

教学内容的生产与管理板块：维护结构化知识卡 JSON，使教师无需改代码即可扩充讲解内容。是 04 知识点标注模块的内容来源。

## 设计目标

1. 结构统一：所有知识卡遵循同一 schema，前端渲染零特判。
2. 关联可靠：知识卡 ID 与模型部位名表（rig-meta）严格同一套键。
3. 内容可审：医学方向审核可按卡逐条进行。

## 实现逻辑

- **存储**：`content/knowledge/*.json`，可按部位或场景分文件。
- **Schema**：
  ```json
  {
    "id": "quadriceps_femoris",        // 与 rig-meta 部位名一致
    "term": { "zh": "股四头肌", "en": "Quadriceps Femoris" },
    "anatomy": "解剖定位文本",
    "biomech": "力学解释文本",
    "clinic": "临床/康复关联文本",
    "refs": [{ "type": "image|link", "src": "...", "caption": "..." }]
  }
  ```
- **一致性校验脚本**（`content/validate.js` 或 pipeline 内）：构建期校验——每张卡的 id 必须存在于 rig-meta 名表；schema 字段完整；引用资源文件存在。校验失败则构建失败，防止脏数据上线。
- **生产流程**：教师撰写 → 按模板填 JSON → 跑校验 → 随静态资源发布。

## 关键依赖

- 上游：rig-meta.json 部位名表（05 产物）——ID 键的唯一权威。
- 下游：04 知识点标注模块（读取渲染）。
- 场景关联：06 场景文件中 keyframes.cardId 必须指向存在的卡（同样纳入校验）。

## 边界范围

- **包含**：知识卡 schema、JSON 内容、构建期一致性校验、内容生产流程约定。
- **不包含**：卡的触发与渲染逻辑（04）、模型命名表生成（05）。

## 核心流程说明

```
教师按模板填写 knowledge/*.json
  → 校验脚本：id ∈ rig-meta 名表？schema 完整？引用资源存在？
      ↳ 失败 → 构建失败，报具体卡片
      ↳ 通过 → 随静态资源发布 → 04 模块按 ID 查卡渲染
```

## 验收要点（P4）

- 首批 ≥25 张卡（5 场景 × ≥5 张），医学方向审核通过。
- 校验脚本可拦截：非法 ID、缺字段、失效引用三类错误（构造反例测试）。
- 新增一张卡仅涉及 JSON 编辑 + 重新部署，无代码改动。

## 实现对齐 `[P4 已实现]`

- **内容源**：`content/knowledge/knowledge.json`，41 张正式教学卡（关键帧卡 10 + 部位卡 14 + 肌肉卡 17），
  每张卡带 note 审查状态标注；构建期由 sync-assets 同步为 `web/public/data/knowledge/knowledge.json`
  （该产物 gitignore，`content/` 为唯一编辑源）。
- **校验**：`web/scripts/validate-knowledge.mjs`（CLI，exit 0 通过 / 1 校验错误 / 2 用法或路径缺失），
  纯函数实现于 `web/scripts/lib/validate-knowledge.mjs`，vitest 反例测试见 `web/src/tests/knowledgeValidate.test.ts`。错误码清单：
  - errors（任一出现即校验失败）：`MISSING_ID` / `DUPLICATE_ID`（卡 id 缺失或重复）、
    `INVALID_PART_ID`（partId 不在 rig-meta id 集）、`KEYFRAME_NO_CARD`（场景关键帧 cardId 无对应卡）、
    `MISSING_TERM` / `MISSING_SECTION`（术语或 anatomy/biomech/clinic 缺字段）、
    `MISSING_REFS`（refs 缺失或不足 2 条）、`INVALID_REF_URL`（url 存在但非 http(s):// 开头）、
    `MISSING_REF_ASSET`（type=image 且 src 资源文件不存在，仅在提供 assetsExist 回调时检查）
  - warnings（不失败）：`MUSCLE_CARD_NOT_IN_SCENES`（肌肉卡 cardId 不在任何场景 muscles，03 曲线点击不联动）、
    `MISSING_NOTE`（缺审查状态标注）
- **构建门**：`npm run sync-assets` 在复制 knowledge 前先跑同一校验，errors 非空即中止同步（防脏数据上线）。
- **refs 实际契约**：`{ label: string; url?: string }`——label 为完整书目条目文本，url 存在时渲染为
  `<a target="_blank" rel="noopener noreferrer">` 外链，否则渲染纯文本。与设计稿
  `{ type: "image|link", src, caption }` 的偏差说明：首批内容以文字书目引用为主、无图片附件需求，
  故简化为 label/url 双字段；`type=image` + `src` 仅作为 MISSING_REF_ASSET 校验的扩展契约保留，前端暂不消费。
- **审查流程**：内容经独立 AI 预审（逐卡术语/数值/临床/一致性四维度 + 场景数据交叉核对 + 文献真实性核查），
  修订与逐卡结论记录见 `content/knowledge/REVIEW.md`；**正式医学专家终审待用户安排签署**，
  签署前内容仅供教学演示用途。
