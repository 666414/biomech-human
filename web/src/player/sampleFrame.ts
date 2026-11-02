/**
 * 帧采样（板块 02）：由场景数据在任意 t 派生一帧回放数据。
 * 时间轴 t 是唯一驱动源，本模块是 t → {关节角, GRF, 肌肉激活, 力矩} 的唯一映射。
 */
import { sampleSeries } from '../interp'
import type { JointAngles, SceneData } from '../types'

/** 一帧回放数据（各序列按 t 线性插值，精确命中帧时取整行） */
export interface PlaybackFrame {
  /** 采样时间（s） */
  time: number
  /** 关节角/位移，键为关节名（与 scene.joints 的 qpos 列序一一对应） */
  jointAngles: JointAngles
  /** 地面反作用力 [fx, fy, fz]（N） */
  grf: [number, number, number]
  /** 肌肉激活度（%MVC），顺序与 scene.muscles 一致 */
  muscleAct: number[]
  /** 执行器广义力（铰链 N·m / 滑移 N），顺序与 scene.joints 一致 */
  torques: number[]
}

/** 采样 t 时刻的一帧；t 越界由 sampleSeries 钳位到端点帧 */
export function sampleFrame(scene: SceneData, t: number): PlaybackFrame {
  const { series, joints } = scene
  const qpos = sampleSeries(series.time, series.qpos, t)
  const jointAngles: JointAngles = {}
  for (let i = 0; i < joints.length; i++) jointAngles[joints[i]] = qpos[i]
  const grf = sampleSeries(series.time, series.grf, t)
  return {
    time: t,
    jointAngles,
    grf: [grf[0] ?? 0, grf[1] ?? 0, grf[2] ?? 0],
    muscleAct: sampleSeries(series.time, series.muscle_act, t),
    torques: sampleSeries(series.time, series.qfrc_actuator, t),
  }
}
