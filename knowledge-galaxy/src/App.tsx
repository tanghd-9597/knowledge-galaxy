import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import OpenAI from 'openai'
import { GalaxyBackground } from './GalaxyBackground'

// === 类型定义 ===
type Flashcard = {
  id: number
  node_id: number
  front: string
  back: string
  knowledge_nodes: { 
    is_mastered: boolean
    category: string 
    created_at?: string
  } | null
}

type ModeType = 'create' | 'review' | 'atlas' // 新增 'atlas' 模式

function App() {
  // === 状态管理 ===
  const [session, setSession] = useState<any>(null)
  const [mode, setMode] = useState<ModeType>('create')
  const [statusMsg, setStatusMsg] = useState('🌌 欢迎来到知识银河')
  const [totalStars, setTotalStars] = useState(0)

  // 录入模式状态
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [previewResult, setPreviewResult] = useState<{ category: string, cards: any[] } | null>(null)

  // 复习模式状态
  const [reviewQueue, setReviewQueue] = useState<Flashcard[]>([])
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)

  // 星图模式状态 (新)
  const [atlasCards, setAtlasCards] = useState<Flashcard[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterCategory, setFilterCategory] = useState<string>('all')

  // === 初始化 AI ===
  const deepseek = new OpenAI({
    baseURL: 'https://api.deepseek.com', 
    apiKey: import.meta.env.VITE_DEEPSEEK_API_KEY,
    dangerouslyAllowBrowser: true 
  })

  // === 颜色配置 ===
  const getCategoryColor = (cat: string) => {
    switch(cat?.toLowerCase()) {
      case 'code': return { bg: '#eef4ff', text: '#2c3e50', tag: '#3498db', label: '💻 代码' }
      case 'english': return { bg: '#fbf0ff', text: '#5b2c6f', tag: '#9b59b6', label: '🔤 英语' }
      case 'note': default: return { bg: '#fffdf0', text: '#795548', tag: '#f39c12', label: '📝 笔记' }
    }
  }

  // === 生命周期 ===
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) fetchTotalStars()
  }, [session])

  // 切换模式时加载对应数据
  useEffect(() => {
    if (!session) return
    if (mode === 'review') fetchReviewCards()
    if (mode === 'atlas') fetchAtlasCards()
  }, [mode, session])

  // === 数据获取 ===

  const fetchTotalStars = async () => {
    const { count } = await supabase
      .from('knowledge_nodes')
      .select('*', { count: 'exact', head: true })
    setTotalStars(count || 0)
  }

  // 🃏 拉取复习卡片
  const fetchReviewCards = async () => {
    setStatusMsg('正在扫描抵达复习轨道的星尘...')
    const nowISO = new Date().toISOString()

    const { data: cardsData } = await supabase.from('flashcards').select('*').limit(50)
    if (!cardsData || cardsData.length === 0) {
      setStatusMsg('暂无卡片。')
      setReviewQueue([])
      return
    }

    const nodeIds = cardsData.map(c => c.node_id)
    const { data: nodesData } = await supabase
      .from('knowledge_nodes')
      .select('id, next_review_at, category') 
      .in('id', nodeIds)
      .lte('next_review_at', nowISO)

    const validCards = cardsData.filter(card => {
      const node = nodesData?.find(n => n.id === card.node_id)
      return !!node
    }).map(card => {
      const node = nodesData?.find(n => n.id === card.node_id)
      return {
        ...card,
        knowledge_nodes: { 
          is_mastered: false,
          category: (node?.category || 'note').toLowerCase()
        }
      }
    })

    if (validCards.length === 0) setStatusMsg(`太棒了！目前的知识点都还没到遗忘时间。`)
    else setStatusMsg(`准备复习！有 ${validCards.length} 颗星尘飞回了轨道。`)

    setReviewQueue(validCards)
    setCurrentCardIndex(0)
    setIsFlipped(false)
  }

  // 🗺️ 拉取星图数据 (所有卡片)
  const fetchAtlasCards = async () => {
    setStatusMsg('正在下载完整星图...')
    
    // 1. 获取所有卡片
    const { data: cardsData, error } = await supabase
      .from('flashcards')
      .select('*')
      .order('id', { ascending: false }) // 最新的在前面
      .limit(100) // 限制100条防止卡顿，实际项目可以用分页

    if (error) {
      console.error(error)
      return
    }

    // 2. 获取对应的节点信息
    const nodeIds = cardsData.map(c => c.node_id)
    const { data: nodesData } = await supabase
      .from('knowledge_nodes')
      .select('id, category, is_mastered, created_at')
      .in('id', nodeIds)

    // 3. 拼装
    const fullCards = cardsData.map(card => {
      const node = nodesData?.find(n => n.id === card.node_id)
      return {
        ...card,
        knowledge_nodes: {
          is_mastered: node?.is_mastered || false,
          category: (node?.category || 'note').toLowerCase(),
          created_at: node?.created_at
        }
      }
    }) as Flashcard[]

    setAtlasCards(fullCards)
    setStatusMsg(`星图加载完毕，共探测到 ${fullCards.length} 个坐标点。`)
  }

  // === 动作处理 ===

  // 🗑️ 删除卡片
  const handleDelete = async (cardId: number, nodeId: number) => {
    if (!confirm('确定要让这颗星星陨落吗？(删除不可恢复)')) return

    // 尝试级联删除：删星星，卡片会自动没
    const { error } = await supabase.from('knowledge_nodes').delete().eq('id', nodeId)
    
    if (error) {
      // 如果没配置级联删除，先删卡片
      await supabase.from('flashcards').delete().eq('id', cardId)
      await supabase.from('knowledge_nodes').delete().eq('id', nodeId)
    }

    // 更新界面
    setAtlasCards(prev => prev.filter(c => c.id !== cardId))
    setTotalStars(prev => prev - 1)
    setStatusMsg('💥 星星已化为尘埃。')
  }

  // AI 录入
  const handleAnalyze = async () => {
    if (!inputText.trim()) return
    setIsLoading(true)
    setStatusMsg('🤔 DeepSeek 正在观测...')
    setPreviewResult(null)

    try {
      const completion = await deepseek.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `你是一个智能知识库助手。请分析用户输入的文本。
            1. **自动分类**：'code' (代码/报错), 'english' (单词/句子), 'note' (普通笔记)。
            2. **提取卡片**：提取关键知识点。
            返回纯 JSON：{ "category": "...", "flashcards": [{"front": "...", "back": "..."}] }`
          },
          { role: "user", content: inputText }
        ],
        model: "deepseek-chat",
        temperature: 0.1,
      })

      const cleanJson = (completion.choices[0].message.content || '{}').replace(/```json|```/g, '').trim()
      const result = JSON.parse(cleanJson)
      const category = (result.category || 'note').toLowerCase()
      const cards = result.flashcards || []

      setPreviewResult({ category, cards })
      
      // 保存
      for (const card of cards) {
        const { data: nodeData } = await supabase
          .from('knowledge_nodes')
          .insert([{ content: card.front, source_context: inputText.slice(0, 50), category }])
          .select()
        if (nodeData) {
            await supabase.from('flashcards').insert([{ node_id: nodeData[0].id, front: card.front, back: card.back }])
        }
      }

      setStatusMsg(`🎉 捕获成功！已归入 [${getCategoryColor(category).label}] 星区。`)
      setInputText('') 
      fetchTotalStars() 
    } catch (error: any) {
      setStatusMsg('❌ ' + error.message)
    } finally {
      setIsLoading(false)
    }
  }

  // 复习动作
  const handleReviewAction = async (action: 'remember' | 'forget') => {
    const currentCard = reviewQueue[currentCardIndex]
    if (!currentCard) return

    const { data: oldNode } = await supabase.from('knowledge_nodes').select('interval_days').eq('id', currentCard.node_id).single()
    let nextInterval = 1

    if (action === 'remember') {
      const currentInterval = oldNode?.interval_days || 0
      nextInterval = currentInterval === 0 ? 1 : Math.ceil(currentInterval * 2.5)
      setStatusMsg(`✨ 记住了！${nextInterval} 天后见。`)
    } else {
      setStatusMsg('没关系，明天再来。')
    }

    const nextDate = new Date()
    nextDate.setDate(nextDate.getDate() + nextInterval)

    await supabase.from('knowledge_nodes').update({ next_review_at: nextDate.toISOString(), interval_days: nextInterval }).eq('id', currentCard.node_id)

    setIsFlipped(false)
    if (currentCardIndex < reviewQueue.length - 1) setCurrentCardIndex(prev => prev + 1)
    else {
      setStatusMsg('🎉 复习完成！')
      setReviewQueue([])
    }
  }

  if (!session) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '100px', fontFamily: 'sans-serif' }}>
      <h1>🌌 Knowledge Galaxy</h1>
      <button onClick={() => supabase.auth.signInWithPassword({ email: 'admin@test.com', password: '你的密码' })} style={{ padding: '10px 20px', cursor: 'pointer', background: '#222', color: '#fff', border: 'none', borderRadius: '4px' }}>点击登录 (测试账号)</button>
    </div>
  )

  // 过滤 Atlas 数据
  const filteredAtlasCards = atlasCards.filter(card => {
    const matchesSearch = (card.front + card.back).toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = filterCategory === 'all' || card.knowledge_nodes?.category === filterCategory
    return matchesSearch && matchesCategory
  })

  // 统计数据
  const stats = {
    total: atlasCards.length,
    code: atlasCards.filter(c => c.knowledge_nodes?.category === 'code').length,
    english: atlasCards.filter(c => c.knowledge_nodes?.category === 'english').length,
    note: atlasCards.filter(c => c.knowledge_nodes?.category === 'note').length
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif', position: 'relative' }}>
      <GalaxyBackground totalStars={totalStars} />

      {/* 顶栏 */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0 }}>🌌 Knowledge Galaxy</h1>
          <p style={{ margin: '5px 0 0 0', color: '#666', fontSize: '14px' }}>{statusMsg}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setMode('create')} style={{ padding: '6px 14px', borderRadius: '16px', border: 'none', cursor: 'pointer', background: mode==='create' ? '#222' : '#eee', color: mode==='create' ? '#fff' : '#333' }}>📥 录入</button>
          <button onClick={() => setMode('review')} style={{ padding: '6px 14px', borderRadius: '16px', border: 'none', cursor: 'pointer', background: mode==='review' ? '#4e6ef2' : '#eee', color: mode==='review' ? '#fff' : '#333' }}>🧠 复习</button>
          <button onClick={() => setMode('atlas')} style={{ padding: '6px 14px', borderRadius: '16px', border: 'none', cursor: 'pointer', background: mode==='atlas' ? '#9b59b6' : '#eee', color: mode==='atlas' ? '#fff' : '#333' }}>🗺️ 星图</button>
        </div>
      </header>

      {/* === 🗺️ 星图模式 === */}
      {mode === 'atlas' && (
        <div style={{ background: 'rgba(255,255,255,0.95)', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}>
          {/* 搜索与过滤栏 */}
          <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <input 
              placeholder="🔍 搜索星星..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #ddd' }}
            />
            <div style={{ display: 'flex', gap: '5px' }}>
              {['all', 'code', 'english', 'note'].map(cat => (
                <button 
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  style={{ 
                    padding: '8px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    background: filterCategory === cat ? '#222' : '#f0f0f0',
                    color: filterCategory === cat ? '#fff' : '#666',
                    textTransform: 'capitalize'
                  }}
                >
                  {cat === 'all' ? `全部 (${stats.total})` : `${cat} (${stats[cat as keyof typeof stats]})`}
                </button>
              ))}
            </div>
          </div>

          {/* 卡片列表网格 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' }}>
            {filteredAtlasCards.map(card => {
              const style = getCategoryColor(card.knowledge_nodes?.category || 'note')
              return (
                <div key={card.id} style={{ 
                    border: `1px solid ${style.bg}`, borderLeft: `5px solid ${style.tag}`,
                    borderRadius: '8px', padding: '15px', background: 'white', position: 'relative' 
                  }}>
                  {/* 分类标签 */}
                  <span style={{ position: 'absolute', top: 10, right: 10, fontSize: '10px', background: style.bg, color: style.text, padding: '2px 6px', borderRadius: '4px' }}>
                    {style.label}
                  </span>
                  
                  <div style={{ fontWeight: 'bold', marginBottom: '8px', paddingRight: '20px' }}>{card.front}</div>
                  <div style={{ color: '#666', fontSize: '0.9em', whiteSpace: 'pre-wrap' }}>{card.back}</div>
                  
                  {/* 删除按钮 */}
                  <button 
                    onClick={() => handleDelete(card.id, card.node_id)}
                    style={{ 
                      position: 'absolute', bottom: 10, right: 10, 
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', opacity: 0.3 
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0.3'}
                    title="删除"
                  >
                    🗑️
                  </button>
                </div>
              )
            })}
          </div>
          {filteredAtlasCards.length === 0 && <p style={{ textAlign: 'center', color: '#999', padding: '40px' }}>未找到匹配的星尘。</p>}
        </div>
      )}

      {/* === 📥 录入模式 (保持不变) === */}
      {mode === 'create' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
          <div style={{ background: 'rgba(255,255,255,0.9)', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <h3>投喂 DeepSeek</h3>
            <textarea value={inputText} onChange={e => setInputText(e.target.value)} placeholder="粘贴代码、英语或笔记..." style={{ width: '100%', height: '200px', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '15px' }} />
            <button onClick={handleAnalyze} disabled={isLoading || !inputText} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer', background: isLoading ? '#ccc' : '#222', color: 'white', fontWeight: 'bold' }}>{isLoading ? '🔮 正在识别...' : '🚀 发射到银河'}</button>
          </div>
          <div>
            <h3>✨ 捕获结果</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '400px', overflowY: 'auto' }}>
              {previewResult?.cards.map((card, idx) => (
                <div key={idx} style={{ background: 'white', padding: '15px', borderRadius: '8px', borderLeft: `4px solid ${getCategoryColor(previewResult.category).tag}`, border: '1px solid #eee' }}>
                  <div style={{ fontWeight: 'bold' }}>{card.front}</div><div style={{ color: '#666' }}>{card.back}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* === 🧠 复习模式 (保持不变) === */}
      {mode === 'review' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 30 }}>
          {reviewQueue.length > 0 ? (
            <>
              <div onClick={() => setIsFlipped(!isFlipped)} style={{ width: '320px', height: '220px', perspective: '1000px', cursor: 'pointer', marginBottom: '30px' }}>
                <div style={{ width: '100%', height: '100%', position: 'relative', transformStyle: 'preserve-3d', transition: 'transform 0.6s', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', borderRadius: '16px' }}>
                  <div style={{ position: 'absolute', width: '100%', height: '100%', backfaceVisibility: 'hidden', background: 'white', border: `2px solid ${getCategoryColor(reviewQueue[currentCardIndex].knowledge_nodes?.category || 'note').bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '25px', borderRadius: '16px', textAlign: 'center', fontWeight: 'bold', fontSize: '1.4em' }}>
                    {reviewQueue[currentCardIndex].front}
                  </div>
                  <div style={{ position: 'absolute', width: '100%', height: '100%', backfaceVisibility: 'hidden', background: '#2c3e50', color: 'white', transform: 'rotateY(180deg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '25px', fontSize: '1.1em', borderRadius: '16px', textAlign: 'center' }}>
                    {reviewQueue[currentCardIndex].back}
                  </div>
                </div>
              </div>
              {isFlipped && <div style={{ display: 'flex', gap: '20px' }}>
                <button onClick={(e) => { e.stopPropagation(); handleReviewAction('forget') }} style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '10px 30px', borderRadius: '25px', cursor: 'pointer', fontWeight: 'bold' }}>😭 忘了</button>
                <button onClick={(e) => { e.stopPropagation(); handleReviewAction('remember') }} style={{ background: '#27ae60', color: 'white', border: 'none', padding: '10px 30px', borderRadius: '25px', cursor: 'pointer', fontWeight: 'bold' }}>✨ 记住了</button>
              </div>}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px', background: 'white', borderRadius: '12px' }}>
              <h3>🎉 暂无待复习的星尘。</h3><button onClick={() => setMode('atlas')} style={{ marginTop: '20px', padding: '10px 20px', background: '#9b59b6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>去看看星图</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App