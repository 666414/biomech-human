/**
 * 知识库构建期一致性校验（P4 Task 1）—— 纯函数，无 fs 依赖。
 *
 * 使用方：
 * - scripts/validate-knowledge.mjs（CLI，exit 0/1/2）
 * - scripts/sync-assets.mjs（复制 knowledge 前拦截脏数据）
 * - src/tests/knowledgeValidate.test.ts（vitest 反例测试）
 *
 * 拦截三类错误（errors 非空 → ok:false）：
 * 1. 非法 ID：INVALID_PART_ID（partId 不在 rig-meta id 集）、
 *    KEYFRAME_NO_CARD（场景 keyframes.cardId 无对应知识卡，逐场景报）、
 *    MISSING_ID / DUPLICATE_ID（卡 id 缺失或重复）
 * 2. 缺字段：MISSING_TERM（term.zh/term.en 空）、MISSING_SECTION（anatomy/biomech/clinic 空串）、
 *    MISSING_REFS（refs 缺失、非数组或 <2 条）
 * 3. 失效引用：INVALID_REF_URL（url 存在但非 http(s):// 开头）、
 *    MISSING_REF_ASSET（扩展契约 type==='image' 且 src 非空但资源文件不存在，
 *    仅在传入 assetsExist 回调时检查——CLI 绑定 --knowledge 同级 assets 目录）
 *
 * warnings（不失败）：MUSCLE_CARD_NOT_IN_SCENES（cardId 不在任何场景 muscles，
 * 也不在任何场景 keyframes cardId 集合）、MISSING_NOTE（note 缺失或空）。
 */

/**
 * @typedef {{index?: number, cardId?: string, scene?: string, code: string, message: string}} ValidateIssue
 */

/**
 * 校验知识卡数组与模型 / 场景数据的一致性。
 *
 * @param {object} input
 * @param {Array} input.cards 知识卡数组（KnowledgeCard[]）
 * @param {Array<{id: string}>} input.rigMetaParts rig-meta.parts（刚体部件列表）
 * @param {Array} input.scenes 场景 JSON 数组（{scene?|name?, muscles?, keyframes?}）
 * @param {((src: string) => boolean) | undefined} [input.assetsExist]
 *   图片 src 存在性检查回调；缺省时跳过 MISSING_REF_ASSET 检查
 * @returns {{ok: boolean, errors: ValidateIssue[], warnings: ValidateIssue[], stats: {
 *   cards: number, partCards: number, keyframeCards: number, muscleCards: number,
 *   unlinkedCards: number, scenes: number, keyframes: number
 * }}}
 */
export function validateKnowledge({ cards, rigMetaParts, scenes, assetsExist } = {}) {
  if (!Array.isArray(cards)) throw new TypeError('cards 必须是数组')
  const errors = []
  const warnings = []

  const partIds = new Set((rigMetaParts ?? []).map((p) => p?.id).filter(Boolean))
  const sceneMuscles = new Set()
  const keyframeCardIds = new Set()
  for (const scene of scenes) {
    for (const m of scene?.muscles ?? []) sceneMuscles.add(m)
    for (const kf of scene?.keyframes ?? []) if (kf?.cardId) keyframeCardIds.add(kf.cardId)
  }
  const sceneCount = scenes.length
  const keyframeCount = scenes.reduce((n, s) => n + (s?.keyframes?.length ?? 0), 0)

  // 1. 场景 keyframes.cardId 必须有对应知识卡（逐场景报）
  const cardIdSet = new Set(cards.map((c) => c?.cardId).filter(Boolean))
  for (const scene of scenes) {
    const sceneName = scene?.scene ?? scene?.name ?? '(未命名场景)'
    for (const kf of scene?.keyframes ?? []) {
      if (!kf?.cardId) {
        errors.push({
          scene: sceneName,
          code: 'KEYFRAME_NO_CARD',
          message: `场景 ${sceneName} 存在缺少 cardId 的关键帧（label: ${kf?.label ?? '?'}）`,
        })
        continue
      }
      if (!cardIdSet.has(kf.cardId)) {
        errors.push({
          scene: sceneName,
          cardId: kf.cardId,
          code: 'KEYFRAME_NO_CARD',
          message: `场景 ${sceneName} 关键帧（t=${kf.t} ${kf.label ?? ''}）引用的 cardId "${kf.cardId}" 没有对应知识卡`,
        })
      }
    }
  }

  // 2. 逐卡校验
  const seenIds = new Set()
  let partCards = 0
  let keyframeCards = 0
  let muscleCards = 0
  let unlinkedCards = 0

  cards.forEach((card, index) => {
    const tag = card?.cardId ? `卡 "${card.cardId}"` : `第 ${index} 张卡`

    if (typeof card?.id !== 'string' || card.id.trim() === '') {
      errors.push({ index, cardId: card?.cardId, code: 'MISSING_ID', message: `${tag} 缺少 id` })
    } else if (seenIds.has(card.id)) {
      errors.push({ index, cardId: card.cardId, code: 'DUPLICATE_ID', message: `${tag} id 重复：${card.id}` })
    } else {
      seenIds.add(card.id)
    }

    if (card?.partId != null && card.partId !== '' && !partIds.has(card.partId)) {
      errors.push({
        index,
        cardId: card.cardId,
        code: 'INVALID_PART_ID',
        message: `${tag} partId "${card.partId}" 不在 rig-meta 部件 id 集合中`,
      })
    }

    const missingTerm = []
    if (!isNonEmptyString(card?.term?.zh)) missingTerm.push('term.zh')
    if (!isNonEmptyString(card?.term?.en)) missingTerm.push('term.en')
    if (missingTerm.length > 0) {
      errors.push({
        index,
        cardId: card.cardId,
        code: 'MISSING_TERM',
        message: `${tag} 缺少 ${missingTerm.join('、')}`,
      })
    }

    const missingSections = []
    for (const section of ['anatomy', 'biomech', 'clinic']) {
      if (!isNonEmptyString(card?.[section])) missingSections.push(section)
    }
    if (missingSections.length > 0) {
      errors.push({
        index,
        cardId: card.cardId,
        code: 'MISSING_SECTION',
        message: `${tag} 缺少字段：${missingSections.join('、')}`,
      })
    }

    if (!Array.isArray(card?.refs) || card.refs.length < 2) {
      errors.push({
        index,
        cardId: card.cardId,
        code: 'MISSING_REFS',
        message: `${tag} refs 缺失或不足 2 条（当前 ${Array.isArray(card?.refs) ? card.refs.length : '无'}）`,
      })
    } else {
      card.refs.forEach((ref, refIndex) => {
        if (typeof ref?.url === 'string' && ref.url !== '' && !/^https?:\/\//i.test(ref.url)) {
          errors.push({
            index,
            cardId: card.cardId,
            code: 'INVALID_REF_URL',
            message: `${tag} 第 ${refIndex + 1} 条引用 url "${ref.url}" 不是 http(s):// 开头`,
          })
        }
        if (ref?.type === 'image' && typeof ref?.src === 'string' && ref.src !== '' && assetsExist) {
          if (!assetsExist(ref.src)) {
            errors.push({
              index,
              cardId: card.cardId,
              code: 'MISSING_REF_ASSET',
              message: `${tag} 第 ${refIndex + 1} 条引用（image）src "${ref.src}" 在 assets 目录中不存在`,
            })
          }
        }
      })
    }

    // 警告：疑似肌肉卡但不在任何场景 muscles（也不在 keyframes cardId 集合）
    if (card?.cardId && !sceneMuscles.has(card.cardId) && !keyframeCardIds.has(card.cardId)) {
      warnings.push({
        index,
        cardId: card.cardId,
        code: 'MUSCLE_CARD_NOT_IN_SCENES',
        message: `${tag} 疑似肌肉卡但不在任何场景的 muscles 列表中（03 曲线点击不会联动）`,
      })
    }
    if (!isNonEmptyString(card?.note)) {
      warnings.push({ index, cardId: card.cardId, code: 'MISSING_NOTE', message: `${tag} 缺少 note 内容标注` })
    }

    if (card?.cardId && keyframeCardIds.has(card.cardId)) keyframeCards++
    else if (card?.cardId && sceneMuscles.has(card.cardId)) muscleCards++
    if (card?.partId) partCards++
    if (!card?.partId && !card?.cardId) unlinkedCards++
  })

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      cards: cards.length,
      partCards,
      keyframeCards,
      muscleCards,
      unlinkedCards,
      scenes: sceneCount,
      keyframes: keyframeCount,
    },
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}
