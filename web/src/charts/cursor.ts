/**
 * 游标像素级工具（板块 03/04，纯函数）：dataZoom 窗口外的 t 不越界绘制。
 * 独立成文件以便单测（ParamCharts 组件文件只导出组件，保持 fast-refresh 语义）。
 */

/**
 * 游标 x 钳制到 grid 左右界内：t 落在 dataZoom 窗口外时 convertToPixel
 * 会把游标画到 grid 之外，此处按 grid rect 裁剪（调用方以布局常量传界）。
 */
export function clampCursorX(px: number, gridLeft: number, gridRight: number): number {
  if (gridRight < gridLeft) return gridLeft
  return Math.min(Math.max(px, gridLeft), gridRight)
}
