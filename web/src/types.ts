/**
 * 数据契约类型（P3 Task 2）
 * 单位约定：hinge 关节 rad / slide 关节 m / 肌肉激活 %MVC（0-100）/ 力 N / 力矩 N·m
 */

/** 关节类型：hinge 旋转（rad）、slide 平移（m） */
export type JointType = 'hinge' | 'slide'

/** 部件分组 */
export type PartGroup = 'skeleton' | 'muscle' | 'skin'

/** 部件上定义的单个关节 */
export interface RigJoint {
  /** 关节名（与场景 joints 数组、qpos 列一一对应） */
  name: string
  type: JointType
  /** 旋转/滑动轴（模型局部坐标方向向量） */
  axis: [number, number, number]
  /** 活动范围：hinge 单位 rad，slide 单位 m */
  range: [number, number]
  /**
   * 关节锚点（body 局部系，MuJoCo joint pos 属性）。hinge 绕该点旋转；
   * slide 不使用。缺省视为原点（旧版 rig-meta 无此字段）。
   */
  anchor?: [number, number, number]
}

/** 模型部件（骨架 / 肌肉 / 皮肤） */
export interface RigPart {
  id: string
  /** 父部件 id，根部件为 null */
  parent: string | null
  names: { en: string; zh: string }
  group: PartGroup
  /** 该部件关联的关节定义 */
  joints: RigJoint[]
}

/** 非骨骼图层的可视节点（挂在 body 下的皮肤胶囊等） */
export interface RigAttachment {
  /** glb 节点名（如 femur_r__femur_skin_r） */
  id: string
  /** 所属 body 节点 id */
  parent: string
  /** 图层分组（非骨骼） */
  group: Exclude<PartGroup, 'skeleton'>
  names: { en: string; zh: string }
}

/** rig-meta.json：模型刚体层级与关节定义 */
export interface RigMeta {
  parts: RigPart[]
  /** 非骨骼图层节点（旧版 rig-meta 无此字段 → 视为无皮肤/肌肉几何） */
  attachments?: RigAttachment[]
}

/** 肌肉示意线的一个附着点（body 局部坐标） */
export interface MusclePoint {
  body: string
  pos: [number, number, number]
}

/** 单块肌肉的示意折线（由肌腱站点顺序展开） */
export interface MuscleDef {
  tendon: string
  points: MusclePoint[]
}

/** muscle-meta.json：执行器名 → 肌肉折线 */
export interface MuscleMeta {
  muscles: Record<string, MuscleDef>
}

/** 场景逐帧数据序列（行数 = frames） */
export interface Series {
  /** 帧时间（s），升序 */
  time: number[]
  /** 广义坐标，每行 len(joints)：hinge rad / slide m */
  qpos: number[][]
  /** 执行器广义力，每行 len(joints)：铰链 N·m / 滑移 N */
  qfrc_actuator: number[][]
  /** 肌肉激活度，每行 len(muscles)，单位 %MVC（0-100） */
  muscle_act: number[][]
  /** 地面反作用力，每行 [fx, fy, fz]，单位 N */
  grf: number[][]
}

/** 场景内标注的关键帧 */
export interface Keyframe {
  /** 关键帧时间（s） */
  t: number
  label: string
  /** 关联知识卡 id */
  cardId: string
}

/** 场景 JSON（/data/scenes/<sceneId>.json） */
export interface SceneData {
  scene: string
  xml: string
  fps: number
  /** 时长（s） */
  duration: number
  frames: number
  joints: string[]
  muscles: string[]
  series: Series
  keyframes: Keyframe[]
}

/** 参考文献条目 */
export interface KnowledgeRef {
  label: string
  url?: string
}

/** 知识卡（/data/knowledge/knowledge.json，数组） */
export interface KnowledgeCard {
  id: string
  /** 关联部件 id（可选） */
  partId?: string
  /** 关联关键帧 cardId（可选） */
  cardId?: string
  term: { zh: string; en: string }
  /** 解剖学说明 */
  anatomy: string
  /** 生物力学说明 */
  biomech: string
  /** 临床要点 */
  clinic: string
  refs: KnowledgeRef[]
  /** 内容标注（如 [stub：P4 医学审核]），可选，审核通过后可移除 */
  note?: string
}

/** 关节名 → 当前角度/位移（hinge rad / slide m） */
export type JointAngles = Record<string, number>
