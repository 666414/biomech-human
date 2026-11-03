/**
 * ECharts 初始化尺寸守卫：宿主任一维非正（0/NaN/负）时立即 init 会触发
 * "Can't get DOM width or height" 告警且画布布局塌缩；且宿主尺寸若不再变化，
 * ResizeObserver 无法事后补救（实测：.charts-box 高度链断裂 → 宿主恒 0 高）。
 * 返回 true 表示应推迟 init，等 ResizeObserver 首次上报非零尺寸后再建实例。
 */
export function shouldDeferInit(width: number, height: number): boolean {
  return !(width > 0 && height > 0)
}
