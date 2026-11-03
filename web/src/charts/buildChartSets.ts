/**
 * 图表数据准备（板块 03，纯函数）：SceneData → 四组 series（角度/力矩/GRF/肌肉激活）。
 * 单位契约：hinge rad→deg 显示、slide m→cm、qfrc_actuator N·m、grf N、muscle_act %MVC。
 * 曲线与读数面板共用本模块的换算，保证与 sampleFrame / JSON 原值一致。
 */
import type { PlaybackFrame } from '../player/sampleFrame'
import type { SceneData } from '../types'

/** 一条曲线的绘图数据（values 已换算为显示单位） */
export interface SeriesData {
  name: string
  unit: string
  time: number[]
  values: number[]
  /** 原始数据列索引：angle/torque → scene.joints 列，muscle → scene.muscles 列 */
  col?: number
}

/** 四组图表的绘图数据 */
export interface ChartSets {
  angles: SeriesData[]
  torques: SeriesData[]
  grf: SeriesData[]
  muscles: SeriesData[]
}

/** 读数面板条目 / 分组 */
export interface ReadoutItem {
  name: string
  value: number
  unit: string
}
export interface ReadoutGroup {
  title: string
  items: ReadoutItem[]
}

/** 教学子集命中模式（关节名包含即命中） */
const TEACHING_JOINT = /hip_flexion|knee_angle|ankle_angle|subtalar|pelvis_tilt|L5_S1_FE|T12_L1_FE|shoulder_elv/
/** 教学子集排除模式（MuJoCo 膝关节平移/配向自由度） */
const NON_TEACHING = /_translation|_rotation|_beta/

/**
 * 教学子集：按模式过滤 scene.joints；双侧关节优先保留 _r、剔除有 _r 对应的 _l，
 * 使每场景落在 3~8 条。保持 scene.joints 原有列序。
 */
export function teachingSubsetJoints(joints: string[]): string[] {
  const matched = joints.filter((n) => TEACHING_JOINT.test(n) && !NON_TEACHING.test(n))
  return matched.filter((n) => !n.endsWith('_l') || !matched.includes(`${n.slice(0, -2)}_r`))
}

/** 关节显示单位：slide 平移 cm，其余（hinge）deg */
export function angleUnitFor(name: string): 'deg' | 'cm' {
  return /_translation|^pelvis_t[xyz]$/.test(name) ? 'cm' : 'deg'
}

/** 原始关节值 → 显示值（rad→deg / m→cm） */
export function convertAngle(name: string, raw: number): number {
  return angleUnitFor(name) === 'cm' ? raw * 100 : raw * (180 / Math.PI)
}

/** grf 行结构 [fx, fy, fz] → 图表主线顺序 fz 在前 */
const GRF_COLS = { fz: 2, fx: 0, fy: 1 } as const

export function buildChartSets(scene: SceneData): ChartSets {
  const { joints, muscles, series } = scene
  const subset = teachingSubsetJoints(joints)

  const angles: SeriesData[] = subset.map((name) => {
    const col = joints.indexOf(name)
    const slide = angleUnitFor(name) === 'cm'
    const factor = slide ? 100 : 180 / Math.PI
    return {
      name,
      unit: slide ? 'cm' : 'deg',
      time: series.time,
      values: series.qpos.map((row) => row[col] * factor),
      col,
    }
  })

  const torques: SeriesData[] = subset.map((name) => {
    const col = joints.indexOf(name)
    return {
      name,
      unit: 'N·m',
      time: series.time,
      values: series.qfrc_actuator.map((row) => row[col]),
      col,
    }
  })

  const grf: SeriesData[] = (['fz', 'fx', 'fy'] as const).map((name) => ({
    name,
    unit: 'N',
    time: series.time,
    values: series.grf.map((row) => row[GRF_COLS[name]]),
  }))

  const muscleSets: SeriesData[] = muscles.map((name, col) => ({
    name,
    unit: '%MVC',
    time: series.time,
    values: series.muscle_act.map((row) => row[col]),
    col,
  }))

  return { angles, torques, grf, muscles: muscleSets }
}

/** 游标时刻读数：与曲线/游标同一帧（sampleFrame 产物），换算口径一致 */
export function readAt(frame: PlaybackFrame, sets: ChartSets): ReadoutGroup[] {
  return [
    {
      title: '关节角',
      items: sets.angles.map((s) => ({
        name: s.name,
        value: convertAngle(s.name, frame.jointAngles[s.name] ?? 0),
        unit: s.unit,
      })),
    },
    {
      title: '关节力矩',
      items: sets.torques.map((s) => ({
        name: s.name,
        value: frame.torques[s.col ?? 0] ?? 0,
        unit: s.unit,
      })),
    },
    {
      title: '地面反作用力',
      items: sets.grf.map((s) => ({
        name: s.name,
        value: frame.grf[GRF_COLS[s.name as keyof typeof GRF_COLS] ?? 0] ?? 0,
        unit: s.unit,
      })),
    },
    {
      title: '肌肉激活',
      items: sets.muscles.map((s) => ({
        name: s.name,
        value: frame.muscleAct[s.col ?? 0] ?? 0,
        unit: s.unit,
      })),
    },
  ]
}
