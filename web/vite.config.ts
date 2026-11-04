import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // 相对路径基座（P5 Task 2）：产物可在任意子目录 / 静态服务器 / U 盘 file:// 部署
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 大依赖分包：three / echarts / react-vendor 独立 chunk，业务代码改动不使其缓存失效
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return 'three'
          // echarts 模块化引入（echarts/core），zrender 是其运行时依赖，随行
          if (/[\\/]node_modules[\\/](echarts|zrender)[\\/]/.test(id)) return 'echarts'
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'react-vendor'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
