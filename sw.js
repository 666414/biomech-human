/*
 * bmhw Service Worker（手写轻量版；位于 public/，构建原样拷贝、不经打包与 hash）
 *
 * 一致性说明：本文件内嵌的 classifyRequest() 与 web/src/sw/policy.ts 的导出纯函数
 * 保持同一判定逻辑——policy.ts 由 vitest 全量覆盖（本文件无法在 vitest 运行，
 * ServiceWorkerGlobalScope），tests/swPolicy.test.ts 另对本文原文做关键标记断言
 * 防漂移。修改任一侧判定逻辑，必须同步另一侧。
 *
 * fetch 策略总览（分类由 classifyRequest 给出）：
 * - pass：非 GET / 跨域 / 部署根之外的路径 → 不接管，放行默认网络
 * - navigate：导航请求 → network-first（版本更新无停机），失败回落缓存的入口页（离线兜底）
 * - data：data/ 下大文件（glb / 场景 JSON）→ stale-while-revalidate，先回缓存同时后台更新
 * - asset：其余静态资源（assets/ hashed 产物、draco decoder、favicon 等）→ cache-first，
 *   未命中拉取并写入缓存
 *
 * —— CACHE_VERSION 递增语义（手工维护）——
 * 预缓存清单（PRECACHE_URLS）变化、入口页兜底语义或 fetch 策略调整时必须递增
 * （p5-skeleton-v1 → p5-skeleton-v2 …），activate 会删除旧代缓存完成整池换代。
 * assets/ 下 hashed 文件内容更新无需递增（文件名即版本，runtime 回填自动跟进）；
 * data/ 内容更新无需递增（stale-while-revalidate 后台刷新）。
 */

const CACHE_VERSION = 'p5-skeleton-v3'

// 预缓存清单：入口页（离线兜底）+ 模型元数据 + 模型本体。glb 在 SW 接管前就开始
// 加载（main.tsx 于 window load 才注册），fetch 拦截不到；靠 HTTP 缓存离线兜底有
// max-age 时效风险，故显式预缓存。hashed 产物名无法硬编码，由 fetch 策略的 runtime
// 回填 + 页面 postMessage('precache-urls') 回填（见底部 message 监听）补齐。
const PRECACHE_URLS = ['./', './data/models/rig-meta.json', './data/models/human.glb']

// —— 策略分类（与 src/sw/policy.ts 的 classifyRequest 保持一致）——
// 部署根从 self.registration.scope 推导（sw 注册在部署根 scope）：base './' 下产物
// 可部署在任意子目录，路径判断必须基于该前缀做相对剥离，不能硬编码 '/' 起始匹配。
function classifyRequest(url, scopeRoot, options) {
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
  } catch (err) {
    return 'pass'
  }
}

// install：预缓存 + skipWaiting（新 SW 立即进入 waiting→active，不等旧页面全部关闭）。
// 逐个 add 容错（不用 addAll）：单个资源失败不阻塞 install。
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.resolve(caches.open(CACHE_VERSION))
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  )
})

// activate：删除非当前版本的旧缓存（版本换代清理），并立即接管已打开页面。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

// fetch：按分类接管。整体 try/catch——分类或 respondWith 注册异常时不接管，走默认网络。
self.addEventListener('fetch', (event) => {
  try {
    const request = event.request
    const scope = self.registration ? self.registration.scope : self.location.href
    const category = classifyRequest(request.url, scope, {
      mode: request.mode,
      method: request.method,
    })
    if (category === 'pass') return
    if (category === 'navigate') {
      event.respondWith(handleNavigate(request))
    } else if (category === 'data') {
      event.respondWith(handleStaleWhileRevalidate(request, event))
    } else {
      event.respondWith(handleCacheFirst(request))
    }
  } catch (err) {
    // 不接管 → 浏览器默认网络行为
  }
})

// 同源导航：network-first；成功顺手把入口页回填缓存，失败回退缓存的入口页（离线兜底）。
// './' 相对 sw 脚本 URL 解析（sw.js 在部署根）→ 即入口页 index.html。
async function handleNavigate(request) {
  try {
    const fresh = await fetch(request)
    if (fresh && fresh.ok) {
      caches.open(CACHE_VERSION)
        .then((cache) => cache.put('./', fresh.clone()))
        .catch(() => {})
    }
    return fresh
  } catch (err) {
    const cache = await caches.open(CACHE_VERSION)
    const shell = await cache.match('./')
    if (shell) return shell
    throw err
  }
}

// data/ 下：stale-while-revalidate。先回缓存，同时后台更新
// （waitUntil 延长 SW 生命周期，保证后台回填完成）。
async function handleStaleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_VERSION)
  const refresh = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {})
      return fresh
    })
    .catch(() => undefined)
  if (event && typeof event.waitUntil === 'function') {
    event.waitUntil(refresh.then(() => undefined))
  }
  const cached = await cache.match(request)
  if (cached) return cached
  const fresh = await refresh
  if (fresh) return fresh
  throw new Error('[sw] stale-while-revalidate：无缓存且网络失败')
}

// 其余同源静态资源：cache-first，未命中则网络拉取并回填缓存。
async function handleCacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION)
  const cached = await cache.match(request)
  if (cached) return cached
  const fresh = await fetch(request)
  if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {})
  return fresh
}

// 首访资源回填（ExtendableMessageEvent）：页面在 SW ready 后把本次加载过的同源资源
// URL 发来，逐个入缓存（allSettled 容错）。URL 先过 classifyRequest，只接管部署根内
// 的 GET 资源，跨域/根外路径一律丢弃。
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'precache-urls' || !Array.isArray(data.urls)) return
  const scope = self.registration ? self.registration.scope : self.location.href
  const urls = data.urls.filter(
    (u) => typeof u === 'string' && classifyRequest(u, scope, { method: 'GET' }) !== 'pass',
  )
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => Promise.allSettled(urls.map((u) => cache.add(u))))
      .then(() => undefined),
  )
})
