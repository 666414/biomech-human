import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import App from '../App'

describe('App 冒烟测试', () => {
  it('渲染不抛异常，顶栏集成控件齐备（Task 7）', async () => {
    expect(() => render(<App />)).not.toThrow()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    // 场景选择 + 分层显示（显隐 checkbox / 透明度滑杆）
    expect(screen.getByLabelText('选择场景')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '分层显示' })).toBeInTheDocument()
    expect(screen.getByLabelText('骨骼显示')).toBeInTheDocument()
    expect(screen.getByLabelText('肌肉不透明度')).toBeInTheDocument()
    // 视角预设（正面/侧面/复位）
    expect(screen.getByRole('group', { name: '视角预设' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '正面' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '侧面' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复位' })).toBeInTheDocument()
    // jsdom 无数据源：场景数据加载失败 → 全屏加载态显示错误 + 重试
    // （视口内另有模型错误浮层的重试按钮，此处仅查 App 级遮罩 role=status）
    const boot = await screen.findByRole('status')
    expect(await within(boot).findByText(/场景数据加载失败/)).toBeInTheDocument()
    expect(within(boot).getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
