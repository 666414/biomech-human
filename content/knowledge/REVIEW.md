# 知识卡独立医学审查记录（P4）

- **审查对象**：`content/knowledge/knowledge.json`（审查前 40 张卡，审查后 41 张）
- **审查日期**：2026-11-04（仓库 master，HEAD=b5a4060 时点内容）
- **审查性质**：AI 专业级预审（独立子代理执行，未参与内容写作）
- **正式医学签认**：待用户安排医学方向专家终审签署

## 一、审查范围与方法

1. **全量逐卡审查**：40 张卡（关键帧卡 10、部位卡 14、肌肉卡 16）按四个维度审计：
   - 术语（解剖学中/英文名标准性、术语-结构对应）
   - 数值与机制（受力倍数、时相、损伤机制是否符教科书共识；数值模糊保守优先）
   - 临床安全（无诊疗/用药建议、风险表述不过度恐吓、损伤机制准确）
   - 内部一致性（跨卡「详见○○卡」指代、跨卡机制口径、卡内叙事与场景数据）
2. **场景数据交叉核对**（`web/public/data/scenes/*.json`，脚本化抽查）：
   - keyframes 时点：gait t=0/0.6、landing t=0.28/0.6、lift t=0.8/1.3、shoulder t=0.6/1.05、ankle t=0.24/0.45 —— 卡内标注全部一致
   - muscles 列表：确认 lift_task 含 `glmax2_r`（补卡依据）；各卡引用的激活相对读数逐一比对 `muscle_act` 序列
   - 关节角数据核对（qpos）：着陆屈膝深度、踝跖屈/距下内翻时相、肩外展角
   - 载荷核对：`pipeline/scenes/lift_task.yaml` 双手 -150 N 外力 → 卡内「150 N（约 15 kg）」成立
   - GRF 口径：gait 场景峰值 ≈5×BW，与 `docs/modules/06-simulation-pipeline.md`「准静态接触压深放大（步态 ≈5×BW）」的既定口径一致；卡片均已附「以波形相对变化为主」的教学声明
3. **文献真实性核查**：逐条核对 refs 中作者/年份/期刊/卷期（Perry 2010、Neumann 2017、Butler 1980 JBJS 62(2):259-272、Hewett 2005 AJSM 33(4):492-501、Nachemson 1966 CORR 45:107-122、Poppen & Walker 1978 Acta Orthop Scand 49(6):486-495、Broström 1964 Acta Chir Scand 128:483-495、Reilly & Martens 1972 43(2):126-136、Hawkins 1970 JBJS 52(5):991-1002、Bergmann 1993 J Biomech 26(8):969-990、Tyler 2001 AJSM 29(2):124-128、Hicks 1954 J Anat 88(1):25-31、Waterman 2010、Vleeming 2012、Michener 2003、Powers 2010、Heiderscheit 2010、Bennell & Brukner 1997、Sanders 1992 及各教材版次）——**未发现虚构文献，无需泛引化处理**

## 二、数值抽查记录（卡内引用 vs 场景 JSON 实测）

| 卡 | 卡内引用 | 场景实测 | 结论 |
| --- | --- | --- | --- |
| mus-vasmed-r | t=0.28 约 52；t≈0.44 峰值约 64 | 52.3；64.3 | ✓ |
| mus-delt1-r | 90° 时约 55；保持段约 55~60 | 55.0；58.8（峰 59.9） | ✓ |
| mus-delt3-r | 90° 时约 50；保持段约 49 | 50.0；49.0 | ✓ |
| mus-trap-cl | 90° 时约 40；保持段约 44 | 40.0；44.1 | ✓ |
| mus-fdl-r | t=0.24 约 20；t=0.45 约 24 | 20.0；24.2（峰 25.0） | ✓ |
| mus-fhl-r | t=0.24 约 20；t=0.45 约 24~25 | 20.0；24.2（峰 25.0） | ✓ |
| mus-glmax2-r（新卡） | 抓握位约 35；起身段约 68、峰约 70 | 35.0；68.3；70.0 | ✓ |

教科书口径类数值（髌股 0.5×/3.3×/7×BW、L5-S1 4~6×BW、盂肱反作用力 ≈0.5 BW≈10×臂重、跟腱 2~3×BW、髋 2.5~3×BW、ACL 前向约束 85%、肩肱节律 2:1、疼痛弧 60°~120°、腓骨肌反射潜伏期 50~80 ms、Böhler 角 25°~40°、颈干角 125°~135°、骶骨水平角 30°~40°、CPR 深度 5~6 cm）逐一对照 Moore/Neumann/Nordin & Frankel/Perry 及原始文献口径，均在共识范围内。

## 三、逐卡结论表

标记：✅ 通过（含既有声明已足够）；✏️ 修订（见改动说明）；🆕 新增。

| # | 卡 id | cardId/partId | 结论 | 改动说明 |
| --- | --- | --- | --- | --- |
| 1 | kf-r-heel-strike | r_heel_strike | ✅ | 时点/激活（胫骨前肌 t=0 峰 40、臀大肌/腘绳肌初期活动）与数据相符；GRF ≈5×BW 与 06 文档口径一致 |
| 2 | kf-r-toe-off | r_toe_off | ✏️ | biomech：原「推进功约占步态总功的 40%~50%」精确带过强（文献测算口径分散），改为「主要动力来源之一，不同测算口径下约占前进总功的四至五成」 |
| 3 | kf-landing-impact | landing_impact | ✅ | Butler 85%、Hewett 2005、GRF 2~4×BW+ 均核对无误；触地微屈姿态与 qpos 相符 |
| 4 | kf-landing-buffer | landing_buffer | ✏️ | biomech：原「本帧代表缓冲最深、离心活动最高」与数据冲突（激活峰值实际在 t≈0.44=64.3，t=0.6 已回落至 44.0；屈膝 0.6 s 时约 80°、0.68 s 方至最深）。改为「最深段附近（屈膝约 80°）+激活峰值在缓冲中期（约 t=0.44）已出现」 |
| 5 | kf-lift-bent | lift_bent | ✅ | 150 N 载荷经 lift_task.yaml 核实；Nachemson 4~6×BW 口径无误 |
| 6 | kf-lift-up | lift_up | ✅ | t=1.3 与伸髋发力段（glmax1 73→75@1.4）相符；跨卡指代「骨盆与 L5 卡」有效 |
| 7 | kf-sh-90 | sh_90 | ✅ | t=0.6 外展角恰为 90.0°；肩肱节律 2:1、疼痛弧、Poppen & Walker 力量级无误 |
| 8 | kf-sh-hold | sh_hold | ✅ | t=1.05 保持段（外展 88°≈90°）；肌力矩平衡叙述无误 |
| 9 | kf-inv-impact | inv_impact | ✏️ | biomech：原「内翻冲击在数十毫秒内完成」与准静态回放（内翻约 0.24 s 渐进到位）易混淆，改为区分「真实扭伤数十毫秒」与「本教学场景为准静态回放」 |
| 10 | kf-inv-risk | inv_risk | ✏️ | anatomy：原「教学场景标注的峰值内翻时刻」对齐场景标注（「踝外侧韧带高风险时刻」）与数据（t=0.45 为跖屈峰值+内翻高位平台），改为复合位表述 |
| 11 | part-pelvis | pelvis | ✏️ | biomech：原「各约 4°~10°」对骨盆侧倾（前后倾约 2°~4°）偏大，保守化为「单平面幅度多在 2°~8°」 |
| 12 | part-sacrum | sacrum | ✅ | 骶骨水平角、骶髂承重、应力性骨折表述均在共识范围 |
| 13 | part-lumbar5 | lumbar5 | ✅ | 4~6×BW、S1 神经根体征、峡部滑脱无误 |
| 14 | part-thoracic12 | thoracic12 | ✅ | 胸腰段应力集中、Chance 骨折、骨质疏松压缩骨折无误 |
| 15 | part-femur-r | femur_r | ✅ | 颈干角、Bergmann 2.5~3×BW、张力侧应力骨折无误 |
| 16 | part-patella-r | patella_r | ✅ | Reilly & Martens 0.5/2.5~3.5/7×BW、软骨厚度约 5 mm（保守表述）无误 |
| 17 | part-tibia-r | tibia_r | ✏️ | anatomy：原括注「腓骨不直接参与膝踝间承重」表述含混（腓骨构成外踝并分担约一成轴向载荷），改为「腓骨与膝关节无直接构成关节，仅分担小腿轴向载荷的约一成」 |
| 18 | part-talus-r | talus_r | ✅ | 60%+ 软骨覆盖、无肌附着、Hawkins 分型、踝穴前宽后窄无误 |
| 19 | part-calcn-r | calcn_r | ✅ | Böhler 角、跟腱 2~3×BW、足跟痛三大来源无误 |
| 20 | part-scapula-r | scapula_r | ✅ | 上旋力偶、胸长神经翼状肩胛无误；「详见 sh_90 卡」有效 |
| 21 | part-clavicle-r | clavicle_r | ✅ | 胸锁关节唯一骨性连结、中 1/3 骨折、AC 分型无误 |
| 22 | part-humerus-r | humerus_r | ✅ | 桡神经沟、外科颈、大结节肩袖无误 |
| 23 | part-hand-r | hand_r | ✅ | 腕骨/指骨计数、150 N 载荷入口、腕管与舟骨无误 |
| 24 | part-sternum | sternum | ✅ | 胸骨角平对第 2 肋、CPR 5~6 cm 无误 |
| 25 | mus-glmax1-r | glmax1_r | ✅ | 臀下神经 L5~S2、止点、步态/着陆/提举时相无误 |
| 26 | mus-bflh-r | bflh_r | ✅ | 胫神经部支配、摆动末期离心负荷、北欧腘绳肌练习无误 |
| 27 | mus-semimem-r | semimem_r | ✅ | 止点与腘斜韧带、ACL 共激活保护口径与 landing_impact 一致 |
| 28 | mus-gaslat-r | gaslat_r | ✅ | 网球腿好发部位（内侧头/跖肌腱）表述准确 |
| 29 | mus-gasmed-r | gasmed_r | ✅ | 长度-张力分配（屈膝位移交比目鱼肌）无误 |
| 30 | mus-soleus-r | soleus_r | ✅ | 单关节肌、胫骨刹车、外周心脏无误 |
| 31 | mus-tibant-r | tibant_r | ✅ | 腓深神经 L4~L5、止点、抗内翻方向特异性（腓骨肌为主）与模型未建模腓骨肌的说明一致 |
| 32 | mus-addlong-r | addlong_r | ✅ | 闭孔神经前支、Tyler 2001 引用真实 |
| 33 | mus-vaslat-r | vaslat_r | ✅ | 「VMO 特异性激活证据有限」为当前共识口径；「详见髌骨卡」有效 |
| 34 | mus-vasmed-r | vasmed_r | ✅ | 激活读数（52/64）与场景数据精确一致 |
| 35 | mus-delt1-r | DELT1_r | ✅ | 读数（55、55~60）一致；腋神经 C5~C6 无误 |
| 36 | mus-delt2-r | DELT2_r | ✅ | 15°~90° 主力外展、冈上肌启动分工无误 |
| 37 | mus-delt3-r | DELT3_r | ✅ | 读数（50、49）一致 |
| 38 | mus-trap-cl | trap_cl | ✅ | 读数（40、44）一致；CN XI+C3~C4 无误 |
| 39 | mus-fdl-r | fdl_r | ✅ | 读数（20、24）一致；Henry 结、S2~S3 无误 |
| 40 | mus-fhl-r | fhl_r | ✅ | 读数（20、24~25）一致；Tom-Dick-ANd-Harry 顺序无误 |
| 41 | mus-glmax2-r | glmax2_r | 🆕 | 新增卡，见下节 |

## 四、新增卡说明：mus-glmax2-r（臀大肌中部束）

- **依据**：`pipeline/scenes/lift_task.yaml` 与 `web/public/data/scenes/lift_task.json` 的 muscles 列表均含 `glmax2_r`，原 40 卡缺少对应卡（03 曲线点击该系列无卡可弹）。
- **写法**：参照 mus-glmax1-r 卡结构；激活读数（抓握位约 35、起身段约 68、峰值约 70）直接取自 lift_task 场景 `muscle_act` 序列，并注明「与上部束（glmax1）曲线平行而幅度略低」（实测 35/68/70 vs 37/73/75）。
- **口径**：中部纤维以伸髋为主、外展分量弱于上部束；clinic 与上部束卡一致并互指，避免跨卡口径矛盾。

## 五、修订类型统计

- **术语**：1 处（part-tibia-r 腓骨承重表述含混 → 精确化）
- **数值**：2 处（kf-r-toe-off 推进功精确带保守化；part-pelvis 骨盆活动幅度 4°~10° → 2°~8°）
- **临床**：0 处（全部卡无诊疗/用药建议，风险表述适度，未见过度恐吓）
- **一致性**：3 处（kf-landing-buffer「离心活动最高」与激活曲线峰值时点冲突；kf-inv-risk「峰值内翻时刻」与场景标注及跖屈峰值时点不匹配；kf-inv-impact 数十毫秒冲击 vs 准静态回放时距混淆）
- **文献**：0 处删除/泛引（全部 refs 真实可查）
- **新增**：1 卡（glmax2_r）

## 六、遗留存疑项（不阻塞发布，供专家终审留意）

1. **步态场景距下关节角恒为 0**：模型步态场景 `subtalar_angle_r` 全程锁定 0°，而 kf-r-heel-strike 卡以教科书口径描述「距下关节随后外翻约 5°~10°」。卡片未声称该读数来自模型，暂不改文；若后续版本开放距下关节自由度，可回补模型读数对照。
2. **肩保持帧外展角为 88°**（qpos 实测 1.536 rad）而非严格 90°；卡内「90° 保持段」按场景标称口径表述，属回放轨迹设计细节，不影响教学结论。
3. **卡内激活读数为模型「相对读数」**（%量纲的准静态目标激活），非实测 EMG %MVC；各卡均已以「相对读数」措辞限定，专家终审时可确认该口径在课堂讲解中的可接受性。
4. **kf-sh-90 biomech「三角肌三束激活随外展角上升」**：DELT3 在外展中后段呈平台（约 50）而非持续上升，措辞取三束总体趋势，未逐束量化；如需更严谨可拆分表述。

## 七、声明

**本审查为 AI 专业预审**：由独立审查子代理基于标准运动解剖学/生物力学教科书共识（Moore《临床应用解剖学》、Neumann《Kinesiology of the Musculoskeletal System》、Nordin & Frankel《Basic Biomechanics of the Musculoskeletal System》、Perry《Gait Analysis》等）与仓库内场景仿真数据完成，目的是使内容经得起运动解剖/运动医学常识核对。**正式医学方向终审待用户安排专家签署**，签署前本内容仅供教学演示用途。
