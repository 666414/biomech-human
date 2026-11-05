import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 不用 StrictMode：其开发期双挂载会在同一 canvas 上创建两次 WebGL 上下文
createRoot(document.getElementById('root')!).render(<App />)

// Service Worker 仅生产注册（P5 Task 3）：dev 行为完全不变；注册路径相对（配合 base './'），
// 失败静默降级不影响应用
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        console.log('[sw] 注册成功，离线缓存已启用，scope:', reg.scope)
      })
      .catch((err: unknown) => {
        console.warn('[sw] 注册失败，跳过离线缓存', err)
      })
  })
}
