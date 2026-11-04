# P4 实施计划：教学内容（板块 07 + 04 内容侧）

日期：2026-11-03 ｜ 分支：master ｜ 执行方式：subagent-driven development

## 目标

把 P3 的 16 张 stub 知识卡升级为正式教学内容：≥32 张（10 关键帧 + 14 部位 + ≥8 肌肉），
医学表述可审可溯；建成构建期一致性校验（拦非法 ID / 缺字段 / 失效引用）；07 文档回填。
对应 docs/modules/07-knowledge-base.md 验收要点（P4）。

## 已核实契约

- 前端卡片契约（P3 已定，以此为准，07 文档的 {type,src,caption} refs 结构将回填为实际实现）：
  `{id, partId?, cardId?, term:{zh,en}, anatomy, biomech, clinic, refs:[{label, url?}], note?}`
- partId 必须 ∈ rig-meta 80 个 body id（已勘察：pelvis/sacrum/lumbar5/thoracic12/femur_r/
  patella_r/tibia_r/talus_r/calcn_r/scapula_r/clavicle_r/humerus_r/hand_r/sternum 等均存在）
- cardId 自由键：10 个场景 keyframe cardId（r_heel_strike/r_toe_off/landing_impact/
  landing_buffer/lift_bent/lift_up/sh_90/sh_hold/inv_impact/inv_risk）+ 肌肉名
  （glmax1_r/bflh_r/semimem_r/gaslat_r/gasmed_r/soleus_r/tibant_r/addlong_r/vaslat_r/
  vasmed_r/DELT1_r/DELT2_r/DELT3_r/trap_cl/fdl_r/fhl_r，与场景 JSON muscles 一致）
- 现有 stub：content/knowledge/knowledge.json 16 张；web vitest 已有真实 JSON 校验测试
  （web/src/tests/knowledge.test.ts）；sync-assets.mjs 复制 content/knowledge → public/data
- 医学审核边界：正式「医学方向审核」须由具备资质人员签认（用户侧流程）；本阶段产出
  内容基于标准教材/共识文献（保守表述、数值给区间并注明来源），由独立审查代理逐卡
  audit + 修订，docs 中明确「待医学专家终审」标注

## 引用规范（防伪造链接）

- refs 每卡 ≥2 条：教材/共识文献的**书目式引用**（label 写「作者. 书名/论文名. 期刊, 年份」）
- URL 仅在高度确信时给（如 MS-Human-700 仓库 https://github.com/LNSGroup/MS-Human-700、
  DOI 稳定的经典论文）；其余一律纯文本引用不给 URL
- 数值（如 ACL 受力、髌股关节压力 3~7×BW、肩肱节律 2:1）必须落在文献常识区间内

## Task 1：构建期一致性校验

**Files**：`web/scripts/validate-knowledge.mjs`（新建）、`web/scripts/sync-assets.mjs`（接入）、
`web/src/tests/knowledgeValidate.test.ts`（反例测试）

- 校验三态：通过（exit 0 + 摘要）/ 失败（exit 1，逐卡报错）
- 拦截三类错误（每类至少 1 个反例测试，用临时坏 fixture 跑校验函数断言报错信息）：
  1. 非法 ID：partId 不在 rig-meta；场景 keyframes.cardId 无对应卡；肌肉卡建议但不必强制
     属场景 muscles（校验打印 warning 不失败）
  2. 缺字段：id/term.zh/term.en/anatomy/biomech/clinic/refs 缺失或空串；refs<2 条
  3. 失效引用：refs[].url 仅校验格式（http/https）；预留 src 资源校验（当前无图片资源，
     若 type 字段出现 image 且 src 存在则检查文件存在——契约扩展，向后兼容）
- 参数：`node scripts/validate-knowledge.mjs --knowledge content/knowledge --rigmeta
  public/data/models/rig-meta.json --scenes public/data/scenes`（cwd=web；路径缺失给明确报错）
- sync-assets 复制 knowledge 前先跑校验，失败即中止（防脏数据上线）
- commit `feat(P4): 知识库构建期一致性校验`

## Task 2：内容生产（32~34 张正式卡）

**Files**：`content/knowledge/knowledge.json`（重写全部卡，删除 stub 性质的占位表述）

- 10 张关键帧卡：与场景数据严格对应（如 r_heel_strike 讲步态初始双支撑 + GRF 峰时相、
  landing_impact 讲着陆冲击 ACL 机制 + 场景实测 GRF 峰量级可引用 06 文档口径）
- 14 张部位卡（partId 见上）：解剖定位（形态/毗邻）/ 生物力学（该部位在 5 场景中的
  受力角色）/ 临床（常见损伤或康复要点）
- 8~10 张肌肉卡（cardId=肌肉名，覆盖 5 场景全部 muscles 集合）：起止点/神经支配/
  力学功能（向心/离心场景）/ 临床——肌肉卡使 03 曲线点击联动出卡
- 术语规范：中文名用标准解剖学名词；每卡 note 字段改填「来源：标准教材 + 独立审查代理已审」
  （终审后由用户确认是否去除）
- 内容一致性：同一名词跨卡口径一致（如 ACL 机制只在 landing_impact 详述，其余卡引用之）
- 自查：跑 Task 1 校验脚本 + web vitest（含真实 JSON 测试）全绿
- commit `feat(P4): 5 场景正式教学知识卡（32+ 张）`

## Task 3：独立医学审查与修订

**Files**：`content/knowledge/knowledge.json`（按审查修订）、
`content/knowledge/REVIEW.md`（审查记录：逐卡结论/修改点/遗留风险）

- 派独立审查代理（不复用写作代理的上下文）逐卡 audit：
  1. 术语正确性（解剖学名词、拉丁/英文对应）
  2. 数值与机制（受力区间、比值、损伤机制是否符合运动医学共识）
  3. 临床表述安全（不给诊疗建议，只讲教学关联；风险表述不夸大）
- 输出：逐卡 通过/修订/存疑；修订直接改 JSON；存疑项列入 REVIEW.md 待人工
- REview.md 同时声明「正式医学方向终审待用户安排专家签署」
- commit `docs(P4): 知识卡独立医学审查记录与修订`

## Task 4：前端接线与文档回填

**Files**：`web/src/knowledge/KnowledgePanel.tsx`（refs 渲染链接 + note 展示微调）、
`web/src/tests/knowledge.test.ts`（更新数量断言 ≥30）、`docs/modules/07-knowledge-base.md`、
`docs/modules/04-knowledge-annotation.md`、`docs/modules/00-overview.md`、`docs/modules/README.md`

- KnowledgePanel：refs[].url 存在时渲染为可点链接（target=_blank rel=noopener）
- 确认 03 曲线点击 → 肌肉卡联动真实命中（用真实肌肉名跑 findSeriesCard 测试）
- vitest 全绿 + build + dev 冒烟
- 文档回填：
  - 07：标题 `[P4 已实现]` + 实现对齐小节（校验脚本路径/接入点、refs 实际契约、
    REVIEW.md 审核流程、待专家终审声明）
  - 04：实现对齐补充（内容已转正、note 语义）
  - 00：排期表 P4 行标注完成（注明专家终审待办）
  - README：07 代码位置回填 `content/knowledge/` + `web/scripts/validate-knowledge.mjs`
- commit `feat(P4): 知识卡前端接线、文档回填与内容转正`

## Task 5：final review + 收尾

- final reviewer：内容抽查（随机 5 卡对照权威常识）、校验反例真实性、文档一致性、
  P4 验收三条逐项判定 → 归档本计划 → 汇报（含「待用户安排医学专家终审」提示）

## 风险

| 风险 | 预案 |
|---|---|
| 引用链接伪造 | 引用规范（书目式为主，URL 白名单策略）+ 审查代理复核 |
| 数值越界 | 数值必须带区间与出处口径；审查代理逐数值核对 |
| 肌肉名与解剖学对应歧义（如 gaslat=腓肠肌外侧头） | 写作代理先从模型 XML/tendon 路径确认肌肉对应关系再写 |
| stub 卡部分内容已审过（P3 审查抽查通过） | 仍全部重写升级，不沿用占位文案 |
