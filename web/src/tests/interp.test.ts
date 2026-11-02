import { describe, expect, it } from 'vitest'
import { interpVec, sampleSeries } from '../interp'

describe('sampleSeries', () => {
  const time = [0, 1, 2]
  const rows = [
    [0, 0, 0],
    [10, 20, 30],
    [40, 50, 60],
  ]

  it('精确帧返回该行（逐元素相等）', () => {
    expect(sampleSeries(time, rows, 0)).toEqual([0, 0, 0])
    expect(sampleSeries(time, rows, 1)).toEqual([10, 20, 30])
    expect(sampleSeries(time, rows, 2)).toEqual([40, 50, 60])
  })

  it('中间 t 线性插值（两帧中间 → 各元素均值）', () => {
    expect(sampleSeries(time, rows, 0.5)).toEqual([5, 10, 15])
    expect(sampleSeries(time, rows, 1.5)).toEqual([25, 35, 45])
  })

  it('非中点的中间 t 按比例插值', () => {
    expect(sampleSeries(time, rows, 0.25)).toEqual([2.5, 5, 7.5])
  })

  it('t 越界（<0 或 >末帧）钳位返回端点行', () => {
    expect(sampleSeries(time, rows, -5)).toEqual([0, 0, 0])
    expect(sampleSeries(time, rows, 99)).toEqual([40, 50, 60])
  })

  it('单帧序列任意 t 都返回该行', () => {
    expect(sampleSeries([0], [[7, 8]], 3)).toEqual([7, 8])
  })
})

describe('interpVec（grf 3 向量同样成立）', () => {
  const time = [0, 2]
  const grf = [
    [0, 0, 500],
    [100, 200, 300],
  ]

  it('精确帧返回该行', () => {
    expect(interpVec(time, grf, 0)).toEqual([0, 0, 500])
    expect(interpVec(time, grf, 2)).toEqual([100, 200, 300])
  })

  it('中间 t 线性插值', () => {
    expect(interpVec(time, grf, 1)).toEqual([50, 100, 400])
  })

  it('t 越界钳位返回端点行', () => {
    expect(interpVec(time, grf, -1)).toEqual([0, 0, 500])
    expect(interpVec(time, grf, 3)).toEqual([100, 200, 300])
  })
})
