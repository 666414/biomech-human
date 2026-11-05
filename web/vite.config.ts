import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * 剔除构建冗余：three 的 DRACOLoader 在模块级用 `new URL('../libs/draco/…', import.meta.url)`
 * 引用了自带的两套解码器，Vite 因此无条件产出 `assets/draco_*`（约 1.33 MB）。
 * 运行时经 `setDecoderPath('./draco/')` 指向 `public/draco/` 下的同名解码器（构建时由
 * sync-assets 复制），这些 assets 副本永远不会被请求，故在写盘前从产物中删除。
 */
function dropEmittedDracoDecoders(): Plugin {
  return {
    name: 'drop-emitted-draco-decoders',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/^assets\/draco_(decoder|wasm_wrapper)-/.test(fileName)) delete bundle[fileName]
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // 相对路径基座（P5 Task 2）：产物可在任意子目录 / 静态服务器部署
  base: './',
  plugins: [react(), dropEmittedDracoDecoders()],
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
