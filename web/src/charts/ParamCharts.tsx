/**
 * 参数曲线面板（板块 03）：单 ECharts 实例、4 个 grid 纵向堆叠共享 x=time。
 * 布局决策：单实例多 grid（而非多实例 connect）——x 轴同步 / 游标 / dataZoom
 * 联动在同一坐标系内天然一致，避免跨实例事件时序差。
 * - 曲线：①关节角（教学子集，deg/cm）②关节力矩 N·m ③GRF N（fz 主线，fx/fy 淡色）
 *   ④肌肉激活 %MVC（每肌肉一条）
 * - 交互态数据经 LTTB 降采样（≤2000 点原样返回）；dataZoom（inside+slider）窗口
 *   变化时按原始数据重窗降采样重渲
 * - 游标：graphic 竖线按 id 增量 setOption（不整卡重建），逐帧与 t 同步（≤1 帧）
 * - 反向联动：点击数据点 / 绘图区空白 → onSeek(value[0])；dataZoom 拖动不触发 seek
 */
import { useEffect, useRef } from 'react'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { init, use as registerChartModules, type ComposeOption, type EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { LineSeriesOption } from 'echarts/charts'
import type {
  DataZoomComponentOption,
  GraphicComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from 'echarts/components'
import type { PlaybackFrame } from '../player/sampleFrame'
import type { SceneData } from '../types'
import { clampCursorX } from './cursor'
import type { ChartSets, SeriesData } from './buildChartSets'
import { lttb } from './lttb'

registerChartModules([
  LineChart,
  GridComponent,
  DataZoomComponent,
  TooltipComponent,
  GraphicComponent,
  LegendComponent,
  CanvasRenderer,
])

type ECOption = ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | DataZoomComponentOption
  | TooltipComponentOption
  | GraphicComponentOption
  | LegendComponentOption
>

/** LTTB 交互态阈值（点数 ≤ 阈值时 lttb 原样返回） */
const LTTB_THRESHOLD = 2000

/** 4 个 grid 的纵向位置（%）：末格底部留出 slider 高度 */
const GRID_TOPS = [0.5, 25.5, 50.5, 75.5]
const GRID_HEIGHT = '20.5%'
const GRID_LEFT = 64
const GRID_RIGHT = 12
const SLIDER_HEIGHT = 18

interface ParamChartsProps {
  scene: SceneData
  sets: ChartSets
  frame: PlaybackFrame | null
  onSeek: (t: number) => void
  /** 曲线系列点击（触发路径 3）：seriesName = 关节/肌肉 id，由 App 层查知识卡 */
  onSeriesClick?: (name: string) => void
}

/** [x, y] 数据对（value[0] 即点击反查的时间） */
function toPairs(s: SeriesData): Array<[number, number]> {
  return s.time.map((x, i) => [x, s.values[i]])
}

/** 原始数据 [lo, hi] 窗口切片 + LTTB 交互态降采样 */
function windowLttb(s: SeriesData, lo: number, hi: number) {
  const { xs, ys } = lttb(s.time.slice(lo, hi + 1), s.values.slice(lo, hi + 1), LTTB_THRESHOLD)
  return xs.map((x, i) => [x, ys[i]] as [number, number])
}

/** time 升序数组中第一个 ≥ v 的下标 */
function lowerBound(time: number[], v: number): number {
  let lo = 0
  let hi = time.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (time[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** time 升序数组中最后一个 ≤ v 的下标（空则 -1） */
function upperBound(time: number[], v: number): number {
  let lo = 0
  let hi = time.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (time[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** dataZoom 窗口变化：按原始数据重窗 + LTTB，增量 setOption 仅更新 series.data */
function rewindow(chart: EChartsType, sets: ChartSets) {
  const time = sets.angles[0]?.time ?? sets.grf[0]?.time ?? sets.muscles[0]?.time ?? []
  const n = time.length
  if (n === 0) return

  let lo = 0
  let hi = n - 1
  const opt = chart.getOption() as { dataZoom?: Array<{ startValue?: number; endValue?: number }> }
  const dz = opt?.dataZoom?.[0]
  if (dz && typeof dz.startValue === 'number' && typeof dz.endValue === 'number') {
    const l = lowerBound(time, dz.startValue)
    const h = upperBound(time, dz.endValue)
    if (l <= h) {
      lo = l
      hi = h
    }
  }

  const all = [...sets.angles, ...sets.torques, ...sets.grf, ...sets.muscles]
  chart.setOption({ series: all.map((s) => ({ data: windowLttb(s, lo, hi) })) })
}

/** 游标竖线增量更新（按 id merge，不整卡重建）；x 钳制在 grid rect 内 */
function applyCursor(chart: EChartsType, t: number, hostWidth: number, hostHeight: number) {
  let px: unknown
  try {
    px = chart.convertToPixel({ xAxisIndex: 0 }, t)
  } catch {
    return // 轴尚未完成布局，下一帧补齐
  }
  if (typeof px !== 'number' || !Number.isFinite(px)) return
  const clampedX = clampCursorX(px, GRID_LEFT, hostWidth - GRID_RIGHT)
  chart.setOption({
    graphic: [
      {
        id: 'cursor',
        type: 'line',
        shape: { x1: 0, y1: 0, x2: 0, y2: Math.max(hostHeight - SLIDER_HEIGHT - 4, 0) },
        x: clampedX,
        y: 0,
      },
    ],
  })
}

function buildOption(sets: ChartSets, duration: number): ECOption {
  const groups: Array<{ list: SeriesData[]; yName: string }> = [
    { list: sets.angles, yName: 'deg' },
    { list: sets.torques, yName: 'N·m' },
    { list: sets.grf, yName: 'N' },
    { list: sets.muscles, yName: '%MVC' },
  ]
  const offsets: number[] = []
  let acc = 0
  for (const g of groups) {
    offsets.push(acc)
    acc += g.list.length
  }

  const series: LineSeriesOption[] = []
  groups.forEach((g, gi) => {
    for (const s of g.list) {
      const isGrfDim = gi === 2 && s.name !== 'fz'
      series.push({
        name: s.name,
        type: 'line',
        xAxisIndex: gi,
        yAxisIndex: gi,
        showSymbol: false,
        data: toPairs(s),
        lineStyle: {
          width: gi === 2 && s.name === 'fz' ? 2 : 1.4,
          opacity: isGrfDim ? 0.35 : 0.92,
        },
        color: isGrfDim ? '#7a8a99' : gi === 2 && s.name === 'fz' ? '#33ddff' : undefined,
        emphasis: { focus: 'series' },
      })
    }
  })

  return {
    animation: false,
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: '#ffb545', width: 1 } },
      valueFormatter: (v) => (typeof v === 'number' ? v.toFixed(1) : ''),
      backgroundColor: 'rgba(10,14,18,0.92)',
      borderColor: '#345',
      textStyle: { color: '#cde', fontSize: 11 },
    },
    grid: GRID_TOPS.map((top) => ({
      left: GRID_LEFT,
      right: GRID_RIGHT,
      top: `${top}%`,
      height: GRID_HEIGHT,
    })),
    xAxis: GRID_TOPS.map((_, gi) => ({
      type: 'value',
      gridIndex: gi,
      min: 0,
      max: duration,
      axisLabel: { show: gi === 3, fontSize: 9, color: '#89a', formatter: (v: number) => v.toFixed(1) },
      axisLine: { show: gi === 3, lineStyle: { color: '#345' } },
      axisTick: { show: false },
      splitLine: { show: false },
    })),
    yAxis: groups.map((g, gi) => ({
      type: 'value',
      gridIndex: gi,
      scale: true,
      name: g.yName,
      nameTextStyle: { color: '#9ab', fontSize: 10 },
      nameGap: 8,
      axisLabel: { fontSize: 9, color: '#89a', formatter: (v: number) => v.toFixed(0) },
      splitLine: { lineStyle: { color: 'rgba(120,140,160,0.14)' } },
    })),
    legend: groups.map((g, gi) => ({
      top: `${GRID_TOPS[gi] + 0.4}%`,
      right: GRID_RIGHT,
      type: 'scroll',
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 4,
      itemGap: 5,
      textStyle: { fontSize: 10, color: '#9ab' },
      pageIconSize: 8,
      backgroundColor: 'rgba(10,14,18,0.6)',
      seriesIndex: g.list.map((_, i) => offsets[gi] + i),
    })),
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2, 3], filterMode: 'none', start: 0, end: 100 },
      {
        type: 'slider',
        xAxisIndex: [0, 1, 2, 3],
        filterMode: 'none',
        start: 0,
        end: 100,
        height: SLIDER_HEIGHT,
        bottom: 0,
        left: GRID_LEFT,
        right: GRID_RIGHT,
        borderColor: '#345',
        backgroundColor: 'rgba(20,26,32,0.6)',
        fillerColor: 'rgba(51,221,255,0.15)',
        handleSize: '60%',
        textStyle: { fontSize: 9, color: '#789' },
      },
    ],
    graphic: [
      {
        id: 'cursor',
        type: 'line',
        silent: true,
        z: 60,
        shape: { x1: 0, y1: 0, x2: 0, y2: 100 },
        x: 0,
        y: 0,
        style: { stroke: '#ffb545', lineWidth: 1 },
      },
    ],
    series,
  }
}

export default function ParamCharts({ scene, sets, frame, onSeek, onSeriesClick }: ParamChartsProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const setsRef = useRef(sets)
  const durationRef = useRef(scene.duration)
  const onSeekRef = useRef(onSeek)
  const onSeriesClickRef = useRef(onSeriesClick)
  const cursorTRef = useRef(0)

  // 挂载：init + 交互事件（实例随宿主生命周期唯一，场景切换走 setOption 重建）
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const chart = init(host)
    chartRef.current = chart

    // 点击数据点 → 取 value[0]（原始帧时间）seek；seriesName 上抛供知识卡查卡
    chart.on('click', (params: unknown) => {
      const p = params as { value?: unknown; seriesName?: unknown }
      if (typeof p.seriesName === 'string') onSeriesClickRef.current?.(p.seriesName)
      const value = p.value
      if (Array.isArray(value) && typeof value[0] === 'number') {
        cursorTRef.current = value[0]
        onSeekRef.current(value[0])
      }
    })

    // 点击绘图区空白 → convertFromPixel 反查 t（点在系列/组件上时不重复触发）
    chart.getZr().on('click', (e: { target?: unknown; offsetX: number; offsetY: number }) => {
      if (e.target) return
      const t = chart.convertFromPixel({ xAxisIndex: 0 }, e.offsetX)
      if (typeof t !== 'number' || !Number.isFinite(t)) return
      const range = chart.convertToPixel({ xAxisIndex: 0 }, [0, durationRef.current])
      if (!Array.isArray(range)) return
      if (e.offsetX < range[0] - 4 || e.offsetX > range[1] + 4) return
      if (e.offsetY > host.clientHeight - SLIDER_HEIGHT - 2) return // slider 区不 seek
      const clamped = Math.min(Math.max(t, 0), durationRef.current)
      cursorTRef.current = clamped
      onSeekRef.current(clamped)
    })

    // dataZoom 拖动结束/进行中：重窗重渲，但不触发 seek（反向联动约束）
    chart.on('dataZoom', () => rewindow(chart, setsRef.current))

    const ro = new ResizeObserver(() => {
      chart.resize()
      applyCursor(chart, cursorTRef.current, host.clientWidth, host.clientHeight)
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  // 最新值引用（事件回调经 ref 取用，避免重复绑定）
  useEffect(() => {
    setsRef.current = sets
    durationRef.current = scene.duration
  }, [sets, scene.duration])
  useEffect(() => {
    onSeekRef.current = onSeek
  }, [onSeek])
  useEffect(() => {
    onSeriesClickRef.current = onSeriesClick
  }, [onSeriesClick])

  // 场景/数据变化：整卡重建（notMerge 重置 dataZoom 窗口），随后补游标
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setOption(buildOption(sets, scene.duration), true)
    applyCursor(
      chart,
      cursorTRef.current,
      hostRef.current?.clientWidth ?? 0,
      hostRef.current?.clientHeight ?? 0,
    )
  }, [sets, scene.duration])

  // 游标跟随 t：每次帧更新增量移动竖线（误差 ≤1 帧）
  useEffect(() => {
    const chart = chartRef.current
    if (!frame || !chart) return
    cursorTRef.current = frame.time
    applyCursor(
      chart,
      frame.time,
      hostRef.current?.clientWidth ?? 0,
      hostRef.current?.clientHeight ?? 0,
    )
  }, [frame])

  return <div ref={hostRef} className="charts-host" />
}
