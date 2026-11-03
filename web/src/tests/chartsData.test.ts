import { describe, expect, it } from 'vitest'
import { angleUnitFor, buildChartSets, readAt, teachingSubsetJoints } from '../charts/buildChartSets'
import { sampleFrame } from '../player/sampleFrame'
import type { SceneData } from '../types'

/** 覆盖教学子集命中/排除/双侧/脊柱/肩各类关节名的 fixture */
function makeScene(): SceneData {
  return {
    scene: 'gait_cycle',
    xml: 'gait_cycle.xml',
    fps: 100,
    duration: 2,
    frames: 3,
    joints: [
      'pelvis_tz', // slide，非教学子集
      'pelvis_tilt', // 命中
      'hip_flexion_r', // 命中
      'knee_angle_r_translation3', // 排除 _translation
      'knee_angle_r', // 命中
      'knee_angle_r_beta_rotation1', // 排除 _beta
      'knee_angle_l', // 左侧：有 _r 对应时被剔除
      'ankle_angle_r', // 命中
      'subtalar_angle_r', // 命中
      'hip_flexion_l', // 左侧剔除
      'ankle_angle_l', // 左侧剔除
      'subtalar_angle_l', // 左侧剔除
      'mtp_angle_r', // 非教学子集
      'L5_S1_FE', // 命中（脊柱）
      'T12_L1_FE', // 命中（脊柱）
      'shoulder_elv_r', // 命中（肩）
      'shoulder_elv_l', // 左侧剔除
      'elbow_flexion_r', // 非教学子集
    ],
    muscles: ['gasmed_r', 'tibant_r'],
    series: {
      time: [0, 1, 2],
      qpos: [
        [0.0, 0.1, 0.2, 9, -0.4, 8, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 7, 1.3, 1.4, 1.5, 1.6, 6],
        [0.1, 0.2, 0.3, 9, -0.2, 8, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 7, 1.2, 1.3, 1.4, 1.5, 6],
        [0.2, 0.3, 0.4, 9, 0.0, 8, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 7, 1.1, 1.2, 1.3, 1.4, 6],
      ],
      qfrc_actuator: [
        [0, 10, 20, 0, 30, 0, 40, 50, 60, 70, 80, 90, 0, 100, 110, 120, 130, 0],
        [1, 11, 21, 0, 31, 0, 41, 51, 61, 71, 81, 91, 0, 101, 111, 121, 131, 0],
        [2, 12, 22, 0, 32, 0, 42, 52, 62, 72, 82, 92, 0, 102, 112, 122, 132, 0],
      ],
      muscle_act: [
        [15, 25],
        [45, 55],
        [85, 95],
      ],
      grf: [
        [-1, -2, 500],
        [100, 20, 600],
        [0, 0, 550],
      ],
    },
    keyframes: [],
  }
}

const DEG = 180 / Math.PI

describe('teachingSubsetJoints（教学子集过滤）', () => {
  it('命中规则：含 hip_flexion/knee_angle/ankle_angle/subtalar/pelvis_tilt/L5_S1_FE/T12_L1_FE/shoulder_elv', () => {
    const subset = teachingSubsetJoints(makeScene().joints)
    expect(subset).toContain('pelvis_tilt')
    expect(subset).toContain('hip_flexion_r')
    expect(subset).toContain('knee_angle_r')
    expect(subset).toContain('ankle_angle_r')
    expect(subset).toContain('subtalar_angle_r')
    expect(subset).toContain('L5_S1_FE')
    expect(subset).toContain('T12_L1_FE')
    expect(subset).toContain('shoulder_elv_r')
  })

  it('排除规则：_translation/_rotation/_beta、slide 与非教学关节', () => {
    const subset = teachingSubsetJoints(makeScene().joints)
    expect(subset).not.toContain('knee_angle_r_translation3')
    expect(subset).not.toContain('knee_angle_r_beta_rotation1')
    expect(subset).not.toContain('pelvis_tz')
    expect(subset).not.toContain('mtp_angle_r')
    expect(subset).not.toContain('elbow_flexion_r')
  })

  it('双侧关节保留 _r、剔除有 _r 对应的 _l（教学子集每场景 3~8 条）', () => {
    const subset = teachingSubsetJoints(makeScene().joints)
    expect(subset).not.toContain('knee_angle_l')
    expect(subset).not.toContain('hip_flexion_l')
    expect(subset).not.toContain('shoulder_elv_l')
    expect(subset.length).toBeLessThanOrEqual(8)
    expect(subset.length).toBeGreaterThanOrEqual(3)
  })

  it('保持 scene.joints 原有列序', () => {
    expect(teachingSubsetJoints(makeScene().joints)).toEqual([
      'pelvis_tilt',
      'hip_flexion_r',
      'knee_angle_r',
      'ankle_angle_r',
      'subtalar_angle_r',
      'L5_S1_FE',
      'T12_L1_FE',
      'shoulder_elv_r',
    ])
  })
})

describe('angleUnitFor（角度单位判定）', () => {
  it('hinge 关节为 deg，slide（pelvis_t*/*_translation*）为 cm', () => {
    expect(angleUnitFor('hip_flexion_r')).toBe('deg')
    expect(angleUnitFor('pelvis_tilt')).toBe('deg')
    expect(angleUnitFor('pelvis_ty')).toBe('cm')
    expect(angleUnitFor('knee_angle_r_translation1')).toBe('cm')
  })
})

describe('buildChartSets（图表数据准备）', () => {
  const scene = makeScene()
  const sets = buildChartSets(scene)

  it('关节角：教学子集逐条 series，rad→deg 换算、单位 deg、共享 time', () => {
    expect(sets.angles.map((s) => s.name)).toEqual(teachingSubsetJoints(scene.joints))
    const hip = sets.angles.find((s) => s.name === 'hip_flexion_r')!
    expect(hip.unit).toBe('deg')
    expect(hip.time).toBe(scene.series.time)
    // qpos[1] 中 hip_flexion_r 列值 0.3 rad → deg
    expect(hip.values[1]).toBeCloseTo(0.3 * DEG, 12)
  })

  it('关节力矩：与教学子集同名同列序，qfrc_actuator 原值（N·m）', () => {
    expect(sets.torques.map((s) => s.name)).toEqual(sets.angles.map((s) => s.name))
    const hipT = sets.torques.find((s) => s.name === 'hip_flexion_r')!
    expect(hipT.unit).toBe('N·m')
    const col = scene.joints.indexOf('hip_flexion_r')
    expect(hipT.values).toEqual(scene.series.qfrc_actuator.map((row) => row[col]))
  })

  it('GRF：fz 主线在前 + fx/fy，单位 N，取 grf 对应列', () => {
    expect(sets.grf.map((s) => s.name)).toEqual(['fz', 'fx', 'fy'])
    expect(sets.grf.every((s) => s.unit === 'N')).toBe(true)
    expect(sets.grf[0].values).toEqual(scene.series.grf.map((row) => row[2]))
    expect(sets.grf[1].values).toEqual(scene.series.grf.map((row) => row[0]))
    expect(sets.grf[2].values).toEqual(scene.series.grf.map((row) => row[1]))
  })

  it('肌肉激活：每肌肉一条，单位 %MVC，取 muscle_act 对应列', () => {
    expect(sets.muscles.map((s) => s.name)).toEqual(['gasmed_r', 'tibant_r'])
    expect(sets.muscles.every((s) => s.unit === '%MVC')).toBe(true)
    expect(sets.muscles[1].values).toEqual(scene.series.muscle_act.map((row) => row[1]))
  })
})

describe('readAt（游标时刻读数）', () => {
  const scene = makeScene()
  const sets = buildChartSets(scene)

  it('精确帧读数与 sampleFrame 一致（换算后）', () => {
    const frame = sampleFrame(scene, 1)
    const groups = readAt(frame, sets)

    const angleGroup = groups.find((g) => g.title === '关节角')!
    for (const item of angleGroup.items) {
      const raw = frame.jointAngles[item.name]
      expect(item.value).toBeCloseTo(raw * DEG, 10)
    }
    // 与 JSON 原值对账：knee_angle_r 列 qpos[1] = -0.2 rad
    const knee = angleGroup.items.find((i) => i.name === 'knee_angle_r')!
    expect(knee.value).toBeCloseTo(-0.2 * DEG, 10)

    const torqueGroup = groups.find((g) => g.title === '关节力矩')!
    const torqueValues = torqueGroup.items.map((i) => i.value)
    const cols = teachingSubsetJoints(scene.joints).map((n) => scene.joints.indexOf(n))
    expect(torqueValues).toEqual(cols.map((c) => frame.torques[c]))
    expect(torqueGroup.items.every((i) => i.unit === 'N·m')).toBe(true)

    const grfGroup = groups.find((g) => g.title === '地面反作用力')!
    expect(grfGroup.items.map((i) => i.name)).toEqual(['fz', 'fx', 'fy'])
    expect(grfGroup.items.map((i) => i.value)).toEqual([frame.grf[2], frame.grf[0], frame.grf[1]])

    const muscleGroup = groups.find((g) => g.title === '肌肉激活')!
    expect(muscleGroup.items.map((i) => i.value)).toEqual(frame.muscleAct)
    expect(muscleGroup.items.every((i) => i.unit === '%MVC')).toBe(true)
  })

  it('中间帧读数与 sampleFrame 插值一致', () => {
    const frame = sampleFrame(scene, 0.5)
    const groups = readAt(frame, sets)
    const angleGroup = groups.find((g) => g.title === '关节角')!
    const pelvis = angleGroup.items.find((i) => i.name === 'pelvis_tilt')!
    expect(pelvis.value).toBeCloseTo(frame.jointAngles['pelvis_tilt'] * DEG, 10)
    const muscleGroup = groups.find((g) => g.title === '肌肉激活')!
    expect(muscleGroup.items.map((i) => i.value)).toEqual(frame.muscleAct)
  })
})
