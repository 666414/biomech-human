import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 不用 StrictMode：其开发期双挂载会在同一 canvas 上创建两次 WebGL 上下文
createRoot(document.getElementById('root')!).render(<App />)
