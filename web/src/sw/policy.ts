/**
 * Service Worker fetch 策略分类（纯函数，供 vitest 全量覆盖）。
 *
 * 注意：public/sw.js 位于 public/（构建原样拷贝、不经打包），无法 import 本模块，
 * 因此 sw.js 内嵌了一份等价实现。两侧判定逻辑必须保持一致——
 * tests/swPolicy.test.ts 另对 sw.js 原文做关键标记断言防漂移；
 * 修改任一侧判定逻辑，必须同步另一侧。
 *
 * 部署根的推导（最容易写错的点）：sw.js 注册在部署根 scope（main.tsx 里
 * register('./sw.js')，scope 默认为 './' 即部署根目录），因此 scope 的 pathname
 * 就是部署根前缀。base './' 下产物可部署在任意子目录（如 /demo/），路径判断
 * 必须基于该前缀做相对剥离，而不是硬编码 '/' 或 'assets/' 全匹配——否则
 * 子目录部署会把根外路径误接管、或把部署根内的资源漏判。
 *
 * 分类语义：
 * - 'pass'：非 GET / 跨域 / 部署根之外的路径 / URL 无法解析 → SW 不接管，放行网络
 * - 'navigate'：部署根内的导航请求 → network-first，失败回落缓存入口页（离线兜底）
 * - 'data'：部署根内 data/ 下（glb / 场景 JSON 等大文件）→ stale-while-revalidate
 * - 'asset'：部署根内其余静态资源（assets/ hashed 产物、draco decoder、favicon 等）
 *   → cache-first，未命中拉取并写入缓存
 */

export type RequestCategory = 'navigate' | 'asset' | 'data' | 'pass'

export interface ClassifyOptions {
  /** Request.mode；导航请求为 'navigate'（XHR/fetch 缺省时按非导航处理） */
  mode?: string
  /** HTTP 方法；缺省按 GET 处理 */
  method?: string
}

export function classifyRequest(
  url: string,
  scopeRoot: string,
  options: ClassifyOptions = {},
): RequestCategory {
  try {
    if ((options.method ?? 'GET').toUpperCase() !== 'GET') return 'pass'
    const target = new URL(url, scopeRoot)
    const scope = new URL(scopeRoot)
    if (target.origin !== scope.origin) return 'pass'
    // 部署根 = scope 目录前缀（补齐结尾斜杠）。部署根之外的同源路径不接管。
    const basePath = scope.pathname.endsWith('/') ? scope.pathname : `${scope.pathname}/`
    if (!target.pathname.startsWith(basePath)) return 'pass'
    if (options.mode === 'navigate') return 'navigate'
    const rel = target.pathname.slice(basePath.length)
    if (rel === 'data' || rel.startsWith('data/')) return 'data'
    return 'asset'
  } catch {
    return 'pass'
  }
}
