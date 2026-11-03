/**
 * validate-knowledge.mjs 的类型声明（供 web/src/tests 与编辑器使用）。
 * 输入类型刻意宽松：校验器要处理的就是可能残缺的数据。
 */

/** 单条校验问题（error 或 warning） */
export interface ValidateIssue {
  /** 卡在数组中的下标 */
  index?: number
  /** 关联的卡 cardId（有关联时） */
  cardId?: string
  /** 关联的场景名（场景级错误时） */
  scene?: string
  code: string
  message: string
}

/** 卡分布统计 */
export interface ValidateStats {
  cards: number
  partCards: number
  keyframeCards: number
  muscleCards: number
  unlinkedCards: number
  scenes: number
  keyframes: number
}

export interface ValidateResult {
  ok: boolean
  errors: ValidateIssue[]
  warnings: ValidateIssue[]
  stats: ValidateStats
}

export interface ValidateKnowledgeInput {
  /** 知识卡数组（契约：KnowledgeCard[]，但残缺数据正是校验对象，故宽松） */
  cards: unknown[]
  /** rig-meta.parts（校验器只读 id） */
  rigMetaParts: Array<{ id?: string }>
  scenes: Array<{
    scene?: string
    name?: string
    muscles?: string[]
    keyframes?: Array<{ t: number; label?: string; cardId: string }>
  }>
  /** 图片 src 存在性检查（缺省时跳过 MISSING_REF_ASSET 检查） */
  assetsExist?: (src: string) => boolean
}

export declare function validateKnowledge(input: ValidateKnowledgeInput): ValidateResult
