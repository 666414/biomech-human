// @vitest-environment node
/**
 * 知识库构建期一致性校验反例测试（P4 Task 1）：
 * 直接 import 校验纯函数（不 spawn 进程），对三类错误 + warnings 逐一给出反例 fixture。
 * 真实 JSON 的内容校验见 knowledge.test.ts；CLI/sync-assets 接线见 scripts/validate-knowledge.mjs。
 */
import { describe, expect, it } from 'vitest'
import { validateKnowledge } from '../../scripts/lib/validate-knowledge.mjs'

/** 测试 fixture 的宽松卡类型（可整字段删除以构造缺字段反例） */
interface TestCard {
  id?: string
  partId?: string
  cardId?: string
  term?: { zh?: string; en?: string }
  anatomy?: string
  biomech?: string
  clinic?: string
  refs?: Array<{ label: string; url?: string; type?: string; src?: string }>
  note?: string
}

const RIG_PARTS = [{ id: 'pelvis' }, { id: 'femur_r' }]

const SCENES = [
  {
    scene: 'gait_cycle',
    muscles: ['gaslat_r', 'glmax1_r'],
    keyframes: [{ t: 0, label: '跟着地', cardId: 'kf_heel' }],
  },
  {
    scene: 'lift_task',
    muscles: ['glmax1_r'],
    keyframes: [],
  },
]

let seq = 0
/** 合法卡 fixture：字段齐全、refs≥2、带 note；按需覆盖字段。 */
function card(overrides: TestCard = {}): TestCard {
  seq += 1
  return {
    id: `card-${seq}`,
    term: { zh: '测试卡', en: 'Test card' },
    anatomy: '解剖说明',
    biomech: '力学说明',
    clinic: '临床要点',
    refs: [{ label: '文献 A' }, { label: '文献 B' }],
    note: '来源：测试 fixture',
    ...overrides,
  }
}

/** 合法数据集：1 部位卡 + 1 关键帧卡（被场景引用）+ 1 肌肉卡（在场景 muscles 中）。 */
function validInput(extraCards: TestCard[] = []) {
  return {
    cards: [
      card({ id: 'part-pelvis', partId: 'pelvis' }),
      card({ id: 'kf-heel', cardId: 'kf_heel' }),
      card({ id: 'mus-gaslat', cardId: 'gaslat_r' }),
      ...extraCards,
    ],
    rigMetaParts: RIG_PARTS,
    scenes: SCENES,
  }
}

describe('validateKnowledge：合法 fixture', () => {
  it('部位卡 + 关键帧卡 + 肌肉卡 → ok:true，errors/warnings 为空', () => {
    const r = validateKnowledge(validInput())
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('stats 统计卡分布：部位 1 / 关键帧 1 / 肌肉 1 / 未关联 0，场景 2 / 关键帧 1', () => {
    const { stats } = validateKnowledge(validInput())
    expect(stats).toEqual({
      cards: 3,
      partCards: 1,
      keyframeCards: 1,
      muscleCards: 1,
      unlinkedCards: 0,
      scenes: 2,
      keyframes: 1,
    })
  })

  it('肌肉卡 cardId 在场景 muscles 中 → 不产生 MUSCLE_CARD_NOT_IN_SCENES 警告', () => {
    const r = validateKnowledge(validInput())
    expect(r.warnings.filter((w) => w.code === 'MUSCLE_CARD_NOT_IN_SCENES')).toEqual([])
  })
})

describe('validateKnowledge 反例：非法 ID', () => {
  it('partId 不在 rig-meta id 集 → INVALID_PART_ID', () => {
    const r = validateKnowledge(validInput([card({ id: 'bad-part', partId: 'femur_x' })]))
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatchObject({ code: 'INVALID_PART_ID', index: 3 })
    expect(r.errors[0].message).toContain('femur_x')
  })

  it('场景 keyframes.cardId 无对应知识卡 → KEYFRAME_NO_CARD（报错含场景名）', () => {
    const scenes = [
      { scene: 'gait_cycle', muscles: [], keyframes: [{ t: 0.5, label: '悬空关键帧', cardId: 'ghost_kf' }] },
    ]
    const r = validateKnowledge({ cards: [card()], rigMetaParts: RIG_PARTS, scenes })
    expect(r.ok).toBe(false)
    const hit = r.errors.filter((e) => e.code === 'KEYFRAME_NO_CARD')
    expect(hit).toHaveLength(1)
    expect(hit[0].cardId).toBe('ghost_kf')
    expect(hit[0].message).toContain('gait_cycle')
  })

  it('卡 id 缺失 → MISSING_ID；id 重复 → DUPLICATE_ID', () => {
    const noId = card()
    delete noId.id
    const r = validateKnowledge(validInput([noId, card({ id: 'part-pelvis' })]))
    const codes = r.errors.map((e) => e.code)
    expect(codes).toContain('MISSING_ID')
    expect(codes).toContain('DUPLICATE_ID')
  })
})

describe('validateKnowledge 反例：缺字段', () => {
  it('clinic 空串 → MISSING_SECTION', () => {
    const r = validateKnowledge(validInput([card({ id: 'no-clinic', clinic: '' })]))
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatchObject({ code: 'MISSING_SECTION', index: 3 })
    expect(r.errors[0].message).toContain('clinic')
  })

  it('term.en 为空 → MISSING_TERM（term.zh 正常不受累）', () => {
    const r = validateKnowledge(validInput([card({ id: 'no-term', term: { zh: '只有中文', en: '' } })]))
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].code).toBe('MISSING_TERM')
    expect(r.errors[0].message).toContain('term.en')
  })

  it('refs 只有 1 条 → MISSING_REFS；refs 缺失 → MISSING_REFS', () => {
    const one = validateKnowledge(validInput([card({ id: 'one-ref', refs: [{ label: '仅 1 条' }] })]))
    expect(one.errors.filter((e) => e.code === 'MISSING_REFS')).toHaveLength(1)

    const none = card({ id: 'no-refs' })
    delete none.refs
    const r2 = validateKnowledge(validInput([none]))
    expect(r2.errors.filter((e) => e.code === 'MISSING_REFS')).toHaveLength(1)
  })
})

describe('validateKnowledge 反例：失效引用', () => {
  it('refs[].url 非 http(s):// 开头 → INVALID_REF_URL', () => {
    const r = validateKnowledge(
      validInput([card({ id: 'bad-url', refs: [{ label: 'A', url: 'www.example.com/x' }, { label: 'B' }] })]),
    )
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatchObject({ code: 'INVALID_REF_URL', index: 3 })
    expect(r.errors[0].message).toContain('www.example.com/x')
  })

  it('http/https url 合法 → 不报 INVALID_REF_URL', () => {
    const r = validateKnowledge(
      validInput([card({ id: 'ok-url', refs: [{ label: 'A', url: 'https://github.com/x' }, { label: 'B', url: 'http://doi.org/y' }] })]),
    )
    expect(r.errors).toEqual([])
  })

  it('扩展契约：type=image 且 src 非空、assetsExist=false → MISSING_REF_ASSET；存在则通过', () => {
    const missing = validateKnowledge({
      ...validInput([card({ id: 'img-missing', refs: [{ label: 'A' }, { label: '图', type: 'image', src: 'figs/acl.png' }] })]),
      assetsExist: () => false,
    })
    expect(missing.errors).toHaveLength(1)
    expect(missing.errors[0]).toMatchObject({ code: 'MISSING_REF_ASSET', index: 3 })
    expect(missing.errors[0].message).toContain('figs/acl.png')

    const present = validateKnowledge({
      ...validInput([card({ id: 'img-ok', refs: [{ label: 'A' }, { label: '图', type: 'image', src: 'figs/acl.png' }] })]),
      assetsExist: () => true,
    })
    expect(present.errors).toEqual([])
  })

  it('未传 assetsExist 时跳过图片资源检查（纯函数默认无 fs 依赖）', () => {
    const r = validateKnowledge(
      validInput([card({ id: 'img-unchecked', refs: [{ label: 'A' }, { label: '图', type: 'image', src: 'nope.png' }] })]),
    )
    expect(r.errors).toEqual([])
  })
})

describe('validateKnowledge 警告（不失败）', () => {
  it('cardId 不在场景 muscles 也不在 keyframes cardId 集合 → MUSCLE_CARD_NOT_IN_SCENES，且 ok 仍为 true', () => {
    const r = validateKnowledge(validInput([card({ id: 'mus-orphan', cardId: 'biceps_weird' })]))
    expect(r.ok).toBe(true)
    const w = r.warnings.filter((x) => x.code === 'MUSCLE_CARD_NOT_IN_SCENES')
    expect(w).toHaveLength(1)
    expect(w[0].cardId).toBe('biceps_weird')
  })

  it('note 缺失 → MISSING_NOTE 警告', () => {
    const noNote = card({ id: 'no-note' })
    delete noNote.note
    const r = validateKnowledge(validInput([noNote]))
    expect(r.ok).toBe(true)
    const w = r.warnings.filter((x) => x.code === 'MISSING_NOTE')
    expect(w).toHaveLength(1)
    expect(w[0].index).toBe(3)
  })
})
