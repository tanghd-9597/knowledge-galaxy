import { useEffect, useRef } from 'react'

export const GalaxyBackground = ({ totalStars }: { totalStars: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    
    // 设置画布大小
    const resize = () => {
      canvas.width = 300
      canvas.height = 300
    }
    resize()

    // 生成星星粒子 (根据你的知识点数量)
    // 基础星星 + 你的知识点数量
    const starCount = 100 + totalStars 
    const stars: { x: number; y: number; size: number; speed: number; angle: number; radius: number }[] = []

    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: 0, 
        y: 0,
        size: Math.random() * 1.5, // 星星大小
        speed: 0.0005 + Math.random() * 0.001, // 旋转速度
        angle: Math.random() * Math.PI * 2, // 初始角度
        radius: Math.random() * 140 // 距离中心的半径
      })
    }

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      // 银河中心的光晕
      const gradient = ctx.createRadialGradient(150, 150, 10, 150, 150, 150)
      gradient.addColorStop(0, 'rgba(78, 110, 242, 0.2)') // 蓝色核心
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.fillStyle = 'white'
      
      stars.forEach(star => {
        // 更新角度 (让它转起来)
        star.angle += star.speed
        
        // 计算新的坐标 (极坐标转直角坐标)
        star.x = 150 + Math.cos(star.angle) * star.radius
        star.y = 150 + Math.sin(star.angle) * star.radius

        ctx.beginPath()
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2)
        ctx.fill()
      })

      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => cancelAnimationFrame(animationFrameId)
  }, [totalStars])

  return (
    <div style={{ position: 'fixed', top: 20, right: 20, zIndex: -1, pointerEvents: 'none' }}>
      <canvas ref={canvasRef} style={{ borderRadius: '50%' }} />
      <div style={{ position: 'absolute', bottom: -30, width: '100%', textAlign: 'center', color: '#666', fontSize: '12px' }}>
        🌌 银河系: {totalStars} 颗星
      </div>
    </div>
  )
}