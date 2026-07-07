import { useState, useEffect, useRef, useCallback } from 'react'
import TriangulacaoView from './TriangulacaoView.jsx'

const STORAGE_KEY = 'mm-mapeamento-cancelamento-parca-v1'

const CARD_DEFS = [
  { id: 's1', lane: 1, col: 2, badge: 'DIA 0', border: 'cliente-border', title: 'Solicita cancelamento', desc: 'Cliente cancela o pedido após já ter recebido o produto.' },
  { id: 's2', lane: 2, col: 3, badge: 'DIA 0', border: 'seller-border', title: 'Seller é notificado', desc: 'Prazo de X dias começa a contar para agendar e realizar a coleta.' },
  { id: 's3', lane: 2, col: 4, badge: 'DECISÃO · DIA 0–X', border: '', decision: true, title: 'Seller coleta dentro do prazo?', desc: 'Verifica se a retirada foi agendada e concluída até o dia X.' },
  { id: 's4', lane: 2, col: 5, badge: 'SIM', border: 'seller-border', end: true, title: 'Coleta concluída', desc: 'Produto retorna ao seller. Caso encerrado sem intervenção.' },
  { id: 's5', lane: 3, col: 5, badge: 'NÃO · DIA X', border: 'ops-border', title: 'Madeira intervém', desc: 'Prazo estourado sem coleta pelo seller. Caso escala para a Ops.' },
  { id: 's6', lane: 3, col: 6, badge: 'DECISÃO · DIA X+', border: '', decision: true, title: 'Coleta ou libera saldo?', desc: 'Critério de escolha entre acionar coleta ou estornar o cliente — a validar.' },
  { id: 's7', lane: 3, col: 7, badge: 'COLETA', border: 'ops-border', title: 'Madeira aciona a coleta', desc: 'Transportadora/parceiro Parça é acionado para retirar o produto.' },
  { id: 's8', lane: 4, col: 7, badge: 'SALDO', border: 'financeiro-border', title: 'Libera saldo ao cliente', desc: 'Financeiro processa o estorno sem aguardar a devolução física.' },
  { id: 's9', lane: 3, col: 8, badge: 'FIM', border: 'ops-border', end: true, title: 'Produto retorna', desc: 'Item volta ao estoque do seller ou é descartado, conforme condição.' },
  { id: 's10', lane: 1, col: 8, badge: 'FIM', border: 'cliente-border', end: true, title: 'Estorno recebido', desc: 'Cliente recebe o saldo. Caso encerrado.' },
]

const CONNECTIONS = [
  { from: 's1', to: 's2' },
  { from: 's2', to: 's3' },
  { from: 's3', to: 's4', label: 'Sim' },
  { from: 's3', to: 's5', label: 'Não' },
  { from: 's5', to: 's6' },
  { from: 's6', to: 's7', label: 'Coleta' },
  { from: 's6', to: 's8', label: 'Saldo' },
  { from: 's7', to: 's9' },
  { from: 's8', to: 's10' },
]

const LANE_LABELS = [
  { row: 1, label: 'Cliente', className: 'cliente', color: 'var(--cliente)' },
  { row: 2, label: 'Seller', className: 'seller', color: 'var(--seller)' },
  { row: 3, label: 'Madeira (Ops)', className: 'ops', color: 'var(--ops)' },
  { row: 4, label: 'Financeiro', className: 'financeiro', color: 'var(--financeiro)' },
]

const DEFAULT_DOCS = {
  etapas: [
    { t: '1. Cliente solicita cancelamento', d: 'Ocorre após a entrega já ter sido confirmada — diferente de um cancelamento pré-envio.' },
    { t: '2. Seller é notificado e o prazo inicia', d: 'Confirmar hoje: a notificação é automática (marketplace) ou depende de checagem manual?' },
    { t: '3. Seller agenda e executa a coleta', d: 'Mapear qual ferramenta o seller usa para agendar (própria transportadora, painel Madeira, etc).' },
    { t: '4. Verificação no dia X', d: 'Definir se essa checagem é automática (sistema fecha o caso) ou manual (analista verifica).' },
    { t: '5. Intervenção da Madeira', d: 'Time responsável por assumir o caso quando o prazo estoura — Gestão Parça, Gestão RCA ou outro?' },
    { t: '6. Decisão: coleta própria ou estorno', d: 'Mapear o critério real de decisão (custo, tipo de produto, disponibilidade de transportadora, escolha do cliente).' },
    { t: '7. Execução (coleta ou saldo)', d: 'Coleta aciona transportadora/parceiro Parça; saldo aciona o financeiro para estorno.' },
    { t: '8. Encerramento do caso', d: 'Confirmar onde esse encerramento fica registrado (Zendesk, planilha, sistema interno) para virar indicador.' },
  ],
  regras: [
    { t: 'Seller coletou dentro do prazo?', d: 'Sim → caso encerra, produto retorna ao seller. Não → escalona para intervenção da Madeira no dia X.' },
    { t: 'Na intervenção, coleta ou libera saldo?', d: 'Critério ainda a validar com o time: pode depender de valor do produto, tipo de produto, custo estimado da coleta, ou preferência do cliente.' },
  ],
  excecoes: [
    { t: 'Produto com avaria', d: 'Fluxo pode mudar dependendo de quem constata o dano (cliente, transportadora ou seller).' },
    { t: 'Seller alega não ter recebido a notificação', d: 'Definir se há prova de envio (log, e-mail, push) para contestar essa alegação.' },
    { t: 'Cliente pede o saldo antes do prazo X', d: 'Definir se isso é possível e sob quais condições.' },
    { t: 'Seller reincidente em não coletar', d: 'Avaliar se isso já entra em algum score de performance do parceiro (ex.: pilar SLA de Coleta).' },
  ],
  indicadores: [
    { t: '% de coletas feitas pelo seller dentro do prazo', d: '' },
    { t: 'Tempo médio até a intervenção da Madeira', d: '' },
    { t: '% de intervenções resolvidas via coleta vs. via estorno', d: '' },
    { t: 'Custo médio da intervenção (frete + operação)', d: '' },
  ],
}

const DEFAULT_TRI = {
  valorProduto: 1000,
  a: { percParceiro: 30, percRepasse: 65 },
  b: { percSeller: 25, percTaxa: 5 },
  c: { percCompra: 15, percRevenda: 30 },
  d: { percParceiro: 30, percCredito: 20 },
}

function defaultCards() {
  const obj = {}
  CARD_DEFS.forEach(c => { obj[c.id] = { title: c.title, desc: c.desc } })
  return obj
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { /* ignore */ }
  return null
}

export default function App() {
  const [view, setView] = useState('fluxo')
  const [cards, setCards] = useState(defaultCards())
  const [docs, setDocs] = useState(DEFAULT_DOCS)
  const [tri, setTriState] = useState(DEFAULT_TRI)
  const [saveNote, setSaveNote] = useState('tudo salvo')
  const wrapRef = useRef(null)
  const cardRefs = useRef({})
  const fileInputRef = useRef(null)
  const saveTimer = useRef(null)

  useEffect(() => {
    const saved = loadState()
    if (saved) {
      if (saved.cards) setCards(saved.cards)
      if (saved.docs) setDocs(saved.docs)
      if (saved.tri) setTriState(saved.tri)
    }
  }, [])

  const scheduleSave = useCallback((nextCards, nextDocs, nextTri) => {
    setSaveNote('editando…')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards: nextCards, docs: nextDocs, tri: nextTri }))
      setSaveNote('salvo ' + new Date().toLocaleTimeString('pt-BR'))
    }, 500)
  }, [])

  function updateCard(id, field, value) {
    setCards(prev => {
      const next = { ...prev, [id]: { ...prev[id], [field]: value } }
      scheduleSave(next, docs, tri)
      return next
    })
  }

  function updateDocItem(section, idx, field, value) {
    setDocs(prev => {
      const list = prev[section].map((item, i) => i === idx ? { ...item, [field]: value } : item)
      const next = { ...prev, [section]: list }
      scheduleSave(cards, next, tri)
      return next
    })
  }

  function addItem(section) {
    setDocs(prev => {
      const next = { ...prev, [section]: [...prev[section], { t: 'Novo item', d: 'Descrição...' }] }
      scheduleSave(cards, next, tri)
      return next
    })
  }

  function deleteItem(section, idx) {
    setDocs(prev => {
      const next = { ...prev, [section]: prev[section].filter((_, i) => i !== idx) }
      scheduleSave(cards, next, tri)
      return next
    })
  }

  function setTri(updater) {
    setTriState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      scheduleSave(cards, docs, next)
      return next
    })
  }

  function exportJSON() {
    const data = { cards, docs, tri }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mapeamento-cancelamento-parca.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function importJSON(evt) {
    const file = evt.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result)
        if (data.cards) setCards(data.cards)
        if (data.docs) setDocs(data.docs)
        if (data.tri) setTriState(data.tri)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
        setSaveNote('importado ' + new Date().toLocaleTimeString('pt-BR'))
      } catch (err) {
        alert('Arquivo inválido.')
      }
    }
    reader.readAsText(file)
    evt.target.value = ''
  }

  function resetAll() {
    if (!window.confirm('Restaurar o conteúdo padrão? As edições feitas serão perdidas.')) return
    localStorage.removeItem(STORAGE_KEY)
    setCards(defaultCards())
    setDocs(DEFAULT_DOCS)
    setTriState(DEFAULT_TRI)
  }

  // Draw connectors
  const drawConnectors = useCallback(() => {
    const svg = document.getElementById('connectors-svg')
    const wrap = wrapRef.current
    if (!svg || !wrap) return
    const wrapRect = wrap.getBoundingClientRect()

    while (svg.lastChild) svg.removeChild(svg.lastChild)

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    defs.innerHTML = `<marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6 Z" fill="#8A97A3"></path></marker>`
    svg.appendChild(defs)

    CONNECTIONS.forEach(conn => {
      const fromEl = cardRefs.current[conn.from]
      const toEl = cardRefs.current[conn.to]
      if (!fromEl || !toEl) return
      const fr = fromEl.getBoundingClientRect()
      const tr = toEl.getBoundingClientRect()
      const x1 = fr.right - wrapRect.left
      const y1 = fr.top - wrapRect.top + fr.height / 2
      const x2 = tr.left - wrapRect.left
      const y2 = tr.top - wrapRect.top + tr.height / 2

      let path
      if (Math.abs(y1 - y2) < 2) {
        path = `M${x1},${y1} L${x2 - 6},${y2}`
      } else {
        const midX = x1 + (x2 - x1) / 2
        path = `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2 - 6},${y2}`
      }
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('d', path)
      p.setAttribute('fill', 'none')
      p.setAttribute('stroke', '#8A97A3')
      p.setAttribute('stroke-width', '1.5')
      p.setAttribute('marker-end', 'url(#arrow)')
      svg.appendChild(p)

      if (conn.label) {
        const lx = x1 + (x2 - x1) / 2
        const ly = y1 + (y2 - y1) / 2 - 6
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        text.setAttribute('x', lx)
        text.setAttribute('y', ly)
        text.setAttribute('font-family', 'IBM Plex Mono, monospace')
        text.setAttribute('font-size', '10.5')
        text.setAttribute('fill', '#5B6B7A')
        text.setAttribute('text-anchor', 'middle')
        text.textContent = conn.label
        svg.appendChild(text)
      }
    })
  }, [])

  useEffect(() => {
    if (view !== 'fluxo') return
    drawConnectors()
    window.addEventListener('resize', drawConnectors)
    return () => window.removeEventListener('resize', drawConnectors)
  }, [drawConnectors, cards, view])

  return (
    <div className="page">
      <header className="top">
        <p className="eyebrow">Excelência Operacional · Gestão Parça</p>
        <h1>Cancelamento pós-entrega — coleta pelo seller</h1>
        <p className="subtitle">Mapeamento do fluxo to-be e as opções em aberto para a triangulação financeira com o parceiro de coleta. Clique em qualquer texto para editar — tudo é salvo automaticamente neste navegador.</p>
        <div className="toolbar">
          <button className="btn primary" onClick={exportJSON}>Exportar dados (.json)</button>
          <button className="btn" onClick={() => fileInputRef.current.click()}>Importar dados</button>
          <input ref={fileInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={importJSON} />
          <button className="btn" onClick={() => window.print()}>Imprimir / PDF</button>
          <button className="btn" onClick={resetAll}>Restaurar padrão</button>
          <span className="save-note">{saveNote}</span>
        </div>

        <div className="tabs">
          <button className={'tab-btn' + (view === 'fluxo' ? ' active' : '')} onClick={() => setView('fluxo')}>
            Fluxo To Be
          </button>
          <button className={'tab-btn' + (view === 'triangulacao' ? ' active' : '')} onClick={() => setView('triangulacao')}>
            Triangulação financeira <span className="pending-dot" title="decisão pendente"></span>
          </button>
        </div>
      </header>

      {view === 'fluxo' && (
        <>
          <div className="legend">
            <span><span className="dot" style={{ background: 'var(--cliente)' }}></span>Cliente</span>
            <span><span className="dot" style={{ background: 'var(--seller)' }}></span>Seller (parceiro)</span>
            <span><span className="dot" style={{ background: 'var(--ops)' }}></span>Madeira Madeira (Ops)</span>
            <span><span className="dot" style={{ background: 'var(--financeiro)' }}></span>Financeiro</span>
            <span><span className="dot" style={{ background: 'var(--decision)', borderRadius: '2px' }}></span>Ponto de decisão</span>
          </div>

          <div className="flow-card">
            <div className="flow-wrap" ref={wrapRef}>
              <svg id="connectors-svg" className="connectors"></svg>
              <div className="flow-grid">
                {LANE_LABELS.map(l => (
                  <div key={l.row} className="lane-label" style={{ gridRow: l.row }}>
                    <span className="chip" style={{ background: l.color }}></span>{l.label}
                  </div>
                ))}
                {LANE_LABELS.map(l => (
                  <div key={'band-' + l.row} className={'lane-band ' + l.className} style={{ gridRow: l.row }}></div>
                ))}

                {CARD_DEFS.map(c => (
                  <div
                    key={c.id}
                    ref={el => { cardRefs.current[c.id] = el }}
                    className={['card', c.border, c.decision ? 'decision' : '', c.end ? 'end' : ''].filter(Boolean).join(' ')}
                    style={{ gridColumn: c.col, gridRow: c.lane }}
                  >
                    <span className="badge">{c.badge}</span>
                    <input
                      className="title-input"
                      value={cards[c.id]?.title ?? ''}
                      onChange={e => updateCard(c.id, 'title', e.target.value)}
                      onBlur={drawConnectors}
                    />
                    <textarea
                      className="desc-input"
                      rows={2}
                      value={cards[c.id]?.desc ?? ''}
                      onChange={e => updateCard(c.id, 'desc', e.target.value)}
                      onBlur={drawConnectors}
                    />
                    {c.end && <span className="end-tag">✓ fim do caso</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <footer className="hint">↳ arraste a barra de rolagem horizontal se necessário · clique em qualquer texto para editar</footer>

          <div className="docs">
            <h2>Documentação do processo</h2>
            <p className="docs-sub">Detalhamento por seção. Clique para editar, use "+ adicionar" para incluir novos itens.</p>

            <DocSection title="Etapas detalhadas" sectionKey="etapas" docs={docs} updateDocItem={updateDocItem} addItem={addItem} deleteItem={deleteItem} defaultOpen />
            <DocSection title="Regras de decisão" sectionKey="regras" docs={docs} updateDocItem={updateDocItem} addItem={addItem} deleteItem={deleteItem} />
            <DocSection title="Exceções" sectionKey="excecoes" docs={docs} updateDocItem={updateDocItem} addItem={addItem} deleteItem={deleteItem} />
            <DocSection title="Indicadores sugeridos" sectionKey="indicadores" docs={docs} updateDocItem={updateDocItem} addItem={addItem} deleteItem={deleteItem} />
          </div>
        </>
      )}

      {view === 'triangulacao' && (
        <TriangulacaoView tri={tri} setTri={setTri} />
      )}
    </div>
  )
}

function DocSection({ title, sectionKey, docs, updateDocItem, addItem, deleteItem, defaultOpen }) {
  const items = docs[sectionKey]
  return (
    <details className="section" open={defaultOpen}>
      <summary>
        {title}
        <span className="count">{items.length}</span>
        <span className="arrow">›</span>
      </summary>
      <div className="section-body">
        <div className="doc-list">
          {items.map((item, idx) => (
            <div className="doc-item" key={idx}>
              <div className="num">{String(idx + 1).padStart(2, '0')}</div>
              <div className="content">
                <input
                  className="t-input"
                  value={item.t}
                  onChange={e => updateDocItem(sectionKey, idx, 't', e.target.value)}
                />
                <textarea
                  className="d-input"
                  rows={2}
                  value={item.d}
                  onChange={e => updateDocItem(sectionKey, idx, 'd', e.target.value)}
                />
              </div>
              <button className="del" title="Remover" onClick={() => deleteItem(sectionKey, idx)}>×</button>
            </div>
          ))}
        </div>
        <button className="add-row" onClick={() => addItem(sectionKey)}>+ adicionar item</button>
      </div>
    </details>
  )
}
