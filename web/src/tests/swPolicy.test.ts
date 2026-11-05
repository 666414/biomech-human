import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyRequest } from '../sw/policy'

/**
 * Service Worker fetch 策略分类（纯函数）全量用例 + public/sw.js 原文防漂移断言。
 * 背景：sw.js 无法在 vitest 运行（ServiceWorkerGlobalScope），故可测的策略分类
 * 抽到 src/sw/policy.ts；sw.js 内嵌等价实现，本文件末尾对 sw.js 原文做关键
 * 标记断言，防止两侧判定逻辑漂移。
 */
const ROOT = 'http://localhost:4173/'

function classify(url: string, mode?: string, method?: string, scope: string = ROOT) {
  return classifyRequest(url, scope, { mode, method })
}

describe('classifyRequest：同源导航 → navigate', () => {
  it('根路径导航', () => {
    expect(classify(ROOT, 'navigate')).toBe('navigate')
  })

  it('带查询参数的导航', () => {
    expect(classify(`${ROOT}?scene=gait`, 'navigate')).toBe('navigate')
  })

  it('同源子路径导航（深链接）', () => {
    expect(classify('http://localhost:4173/app/sub/page', 'navigate')).toBe('navigate')
  })
})

describe('classifyRequest：同源 data/ 下 GET → data（stale-while-revalidate）', () => {
  it('场景 JSON', () => {
    expect(classify('http://localhost:4173/data/scenes/gait_cycle.json')).toBe('data')
  })

  it('模型 glb 与元数据', () => {
    expect(classify('http://localhost:4173/data/models/human.glb')).toBe('data')
    expect(classify('http://localhost:4173/data/models/rig-meta.json')).toBe('data')
  })

  it('带查询参数的 data 请求仍判 data', () => {
    expect(classify('http://localhost:4173/data/scenes/lift_task.json?v=2')).toBe('data')
  })

  it('相对路径（相对部署根解析）判 data', () => {
    expect(classify('data/models/rig-meta.json')).toBe('data')
  })

  it('data/ 前缀陷阱：data-backup.json、database/x.json 不是 data/ 目录 → asset', () => {
    expect(classify('http://localhost:4173/data-backup.json')).toBe('asset')
    expect(classify('http://localhost:4173/database/x.json')).toBe('asset')
  })
})

describe('classifyRequest：同源其余静态资源 → asset（cache-first）', () => {
  it('hashed 业务 chunk', () => {
    expect(classify('http://localhost:4173/assets/index-BQ9abc123.js')).toBe('asset')
  })

  it('draco decoder（离线也需要）', () => {
    expect(classify('http://localhost:4173/draco/draco_decoder.wasm')).toBe('asset')
    expect(classify('http://localhost:4173/draco/draco_wasm_wrapper.js')).toBe('asset')
  })

  it('根下静态文件', () => {
    expect(classify('http://localhost:4173/favicon.svg')).toBe('asset')
    expect(classify('http://localhost:4173/icons.svg')).toBe('asset')
  })

  it('相对路径（相对部署根解析）判 asset', () => {
    expect(classify('assets/index-abc.js')).toBe('asset')
  })
})

describe('classifyRequest：非 GET → pass', () => {
  it('POST（即使指向 data/）', () => {
    expect(classify('http://localhost:4173/data/scenes/gait_cycle.json', undefined, 'POST')).toBe('pass')
  })

  it('HEAD 与 DELETE', () => {
    expect(classify('http://localhost:4173/assets/index.js', undefined, 'HEAD')).toBe('pass')
    expect(classify('http://localhost:4173/data/models/human.glb', undefined, 'DELETE')).toBe('pass')
  })

  it('方法大小写归一：小写 get 按 GET 判定', () => {
    expect(classify('http://localhost:4173/data/models/human.glb', undefined, 'get')).toBe('data')
  })
})

describe('classifyRequest：跨域 / 特殊 URL → pass', () => {
  it('跨域静态资源', () => {
    expect(classify('https://cdn.example.com/lib.js')).toBe('pass')
  })

  it('跨域导航', () => {
    expect(classify('https://other.example.com/page', 'navigate')).toBe('pass')
  })

  it('跨域且非 GET', () => {
    expect(classify('https://cdn.example.com/api', undefined, 'POST')).toBe('pass')
  })

  it('data: URL（origin 为 null）', () => {
    expect(classify('data:text/plain,x')).toBe('pass')
  })

  it('无法解析的 URL', () => {
    expect(classify('http://[invalid')).toBe('pass')
  })
})

describe('classifyRequest：子目录部署 scope（base \'./\'，规格锁定用例）', () => {
  const DEMO = 'http://example.com/demo/'

  it("scope '/demo/' 下 '/demo/assets/x.js' → asset", () => {
    expect(classify('http://example.com/demo/assets/x.js', undefined, undefined, DEMO)).toBe('asset')
  })

  it("scope '/demo/' 下 '/demo/data/x.json' → data", () => {
    expect(classify('http://example.com/demo/data/x.json', undefined, undefined, DEMO)).toBe('data')
  })

  it("scope '/demo/' 下 '/other/y' → pass（部署根之外不接管）", () => {
    expect(classify('http://example.com/other/y', undefined, undefined, DEMO)).toBe('pass')
  })

  it('scope 省略结尾斜杠（/demo）仍正确推导部署根', () => {
    expect(classify('http://example.com/demo/data/x.json', undefined, undefined, 'http://example.com/demo')).toBe('data')
    expect(classify('http://example.com/demo/assets/x.js', undefined, undefined, 'http://example.com/demo')).toBe('asset')
  })

  it('子目录内导航 → navigate；子目录内 favicon → asset', () => {
    expect(classify('http://example.com/demo/', 'navigate', undefined, DEMO)).toBe('navigate')
    expect(classify('http://example.com/demo/favicon.svg', undefined, undefined, DEMO)).toBe('asset')
  })

  it('部署在根 scope 时全部同源路径都在根内（不误判 pass）', () => {
    expect(classify('http://example.com/other/y', undefined, undefined, 'http://example.com/')).toBe('asset')
  })
})

describe('classifyRequest：mode 缺省（XHR/延迟场景退化）', () => {
  it('data/ 仍判 data，assets 判 asset', () => {
    expect(classify('http://localhost:4173/data/scenes/ankle_inversion.json')).toBe('data')
    expect(classify('http://localhost:4173/assets/charts.js')).toBe('asset')
  })
})

describe('public/sw.js 原文防漂移（内嵌策略与 policy.ts 一致性的锚点）', () => {
  const swSource = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

  it('缓存 key 版本化 p5-skeleton-v1，且含 CACHE_VERSION 递增语义注释', () => {
    expect(swSource).toContain("const CACHE_VERSION = 'p5-skeleton-v1'")
    expect(swSource).toContain('CACHE_VERSION 递增语义')
  })

  it('install 预缓存入口页与 rig-meta.json，并 skipWaiting', () => {
    expect(swSource).toContain("'./'")
    expect(swSource).toContain('./data/models/rig-meta.json')
    expect(swSource).toContain('skipWaiting')
  })

  it('activate 清理旧缓存并 clients.claim 接管', () => {
    expect(swSource).toContain('clients.claim')
    expect(swSource).toContain('caches.delete')
  })

  it('三类 fetch 策略字样齐备', () => {
    expect(swSource).toContain('network-first')
    expect(swSource).toContain('cache-first')
    expect(swSource).toContain('stale-while-revalidate')
  })

  it('内嵌分类函数与 policy.ts 同名且声明一致性（防漂移锚点）', () => {
    expect(swSource).toContain('function classifyRequest')
    expect(swSource).toContain('src/sw/policy.ts')
  })

  it('内嵌分类核心判定与 policy.ts 逐行一致（取关键行锚定）', () => {
    const policySource = readFileSync(resolve(process.cwd(), 'src/sw/policy.ts'), 'utf8')
    const keyLines = [
      "if ((options.method ?? 'GET').toUpperCase() !== 'GET') return 'pass'",
      "if (target.origin !== scope.origin) return 'pass'",
      "if (!target.pathname.startsWith(basePath)) return 'pass'",
      "if (options.mode === 'navigate') return 'navigate'",
      "if (rel === 'data' || rel.startsWith('data/')) return 'data'",
    ]
    for (const line of keyLines) {
      expect(swSource).toContain(line)
      expect(policySource).toContain(line)
    }
  })
})
