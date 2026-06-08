import {
  startTransition,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react'

import { supportedModels, type SupportedModelId } from './data/models'
import type {
  AssistantProgress,
  AssistantRequest,
  AssistantResult,
} from './lib/assistant'
import type { CompileContext, ScriptSummary } from './lib/miniscriptTooling'

type RunState = 'idle' | 'loading-model' | 'running' | 'error'

function App() {
  const [modelId, setModelId] = useState<SupportedModelId>(supportedModels[0].id)
  const [mode, setMode] = useState<'design' | 'inspect' | 'compare'>('design')
  const [context, setContext] = useState<CompileContext>('p2wsh')
  const [prompt, setPrompt] = useState(
    'Design a family recovery script where any two of Alice, Bob, and Carol can spend.',
  )
  const [leftPrompt, setLeftPrompt] = useState(
    'thresh(2,pk(Alice),pk(Bob),pk(Carol))',
  )
  const [rightPrompt, setRightPrompt] = useState(
    'or(and(pk(Alice),pk(Bob)),and(pk(Carol),after(900000)))',
  )
  const [runState, setRunState] = useState<RunState>('idle')
  const [progress, setProgress] = useState<AssistantProgress | null>(null)
  const [result, setResult] = useState<AssistantResult | null>(null)
  const [quickSummary, setQuickSummary] = useState<ScriptSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const assistantRef = useRef<{
    modelId: SupportedModelId
    run: (request: AssistantRequest) => Promise<AssistantResult>
  } | null>(null)

  const currentModel =
    supportedModels.find((model) => model.id === modelId) ?? supportedModels[0]

  const handleProgress = useEffectEvent((nextProgress: AssistantProgress) => {
    setProgress(nextProgress)
  })

  useEffect(() => {
    const source =
      mode === 'compare'
        ? leftPrompt
        : prompt

    if (!source.trim()) {
      setQuickSummary(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const tooling = await import('./lib/miniscriptTooling')
        const summary = await tooling.summarizeExpression(source, context)
        if (!cancelled) {
          setQuickSummary(summary)
        }
      } catch {
        if (!cancelled) {
          setQuickSummary(null)
        }
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [context, leftPrompt, mode, prompt])

  async function ensureAssistant() {
    if (assistantRef.current?.modelId === modelId) {
      return assistantRef.current
    }
    setRunState('loading-model')
    const assistantModule = await import('./lib/assistant')
    const assistant = await assistantModule.loadAssistant(modelId, handleProgress)
    assistantRef.current = assistant
    return assistant
  }

  async function runAssistant() {
    setError(null)
    setProgress(null)
    setRunState('running')
    try {
      const assistant = await ensureAssistant()
      const nextResult =
        mode === 'compare'
          ? await assistant.run({
              mode,
              left: leftPrompt,
              right: rightPrompt,
              context,
            })
          : await assistant.run({
              mode,
              prompt,
              context,
            })
      startTransition(() => {
        setResult(nextResult)
      })
      setRunState('idle')
    } catch (caught) {
      setRunState('error')
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="eyebrow">Local Miniscript Workbench</div>
        <h1>Compile policy drafts, inspect spending paths, and sketch the shape of authority.</h1>
        <p className="lede">
          This runs a small model in the browser through Ax + WebLLM, then forces
          every answer through the real miniscript compiler and analyzer before it
          is trusted.
        </p>
      </header>

      <section className="control-grid">
        <div className="panel control-panel">
          <div className="panel-label">Assistant</div>
          <div className="segmented">
            {(['design', 'inspect', 'compare'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={option === mode ? 'active' : ''}
                onClick={() => setMode(option)}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="two-up">
            <label>
              <span>Model</span>
              <select
                value={modelId}
                onChange={(event) =>
                  setModelId(event.target.value as SupportedModelId)
                }
              >
                {supportedModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Context</span>
              <select
                value={context}
                onChange={(event) =>
                  setContext(event.target.value as CompileContext)
                }
              >
                <option value="p2wsh">P2WSH</option>
                <option value="taproot">Taproot</option>
              </select>
            </label>
          </div>

          <p className="field-note">{currentModel.note}</p>

          {mode === 'compare' ? (
            <div className="compare-fields">
              <label>
                <span>Candidate A</span>
                <textarea
                  value={leftPrompt}
                  onChange={(event) => setLeftPrompt(event.target.value)}
                  rows={7}
                />
              </label>
              <label>
                <span>Candidate B</span>
                <textarea
                  value={rightPrompt}
                  onChange={(event) => setRightPrompt(event.target.value)}
                  rows={7}
                />
              </label>
            </div>
          ) : (
            <label>
              <span>{mode === 'design' ? 'Intent' : 'Policy or Miniscript'}</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={8}
              />
            </label>
          )}

          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => void runAssistant()}
              disabled={runState === 'loading-model' || runState === 'running'}
            >
              {runState === 'loading-model'
                ? 'Loading model'
                : runState === 'running'
                  ? 'Running'
                  : 'Run workbench'}
            </button>
            <div className="status">
              {progress ? (
                <>
                  <strong>{progress.stage}</strong>
                  <span>{progress.detail}</span>
                </>
              ) : (
                <>
                  <strong>compiler guardrail</strong>
                  <span>Every result is compiled before display.</span>
                </>
              )}
            </div>
          </div>

          {error ? <p className="error">{error}</p> : null}
        </div>

        <div className="panel aside-panel">
          <div className="panel-label">Live check</div>
          {quickSummary ? (
            <>
              <p className="aside-title">
                {quickSummary.kind === 'policy'
                  ? 'Current input parses as a policy'
                  : 'Current input parses as miniscript'}
              </p>
              <dl className="stats">
                <div>
                  <dt>Valid</dt>
                  <dd>{String(quickSummary.valid)}</dd>
                </div>
                <div>
                  <dt>Sane</dt>
                  <dd>{String(quickSummary.sane)}</dd>
                </div>
                <div>
                  <dt>Non-malleable</dt>
                  <dd>{String(quickSummary.nonMalleable)}</dd>
                </div>
              </dl>
              <p className="inline-code">{quickSummary.miniscript}</p>
              {quickSummary.error ? (
                <p className="error subtle">{quickSummary.error}</p>
              ) : null}
            </>
          ) : (
            <p className="empty-state">
              Type a policy or miniscript expression to get an immediate parser/analyzer signal.
            </p>
          )}
        </div>
      </section>

      {result ? <ResultView result={result} /> : <EmptyWorkbench />}
    </div>
  )
}

function EmptyWorkbench() {
  return (
    <section className="panel empty-workbench">
      <div className="panel-label">Workbench output</div>
      <p>
        The app is optimized for three tasks: drafting policies from intent,
        inspecting existing constructions, and comparing alternatives after real
        compilation.
      </p>
    </section>
  )
}

function ResultView({ result }: { result: AssistantResult }) {
  if (result.mode === 'compare') {
    return (
      <section className="result-grid">
        <SummaryCard title="Candidate A" summary={result.left} />
        <SummaryCard title="Candidate B" summary={result.right} />
        <section className="panel narrative">
          <div className="panel-label">Comparison</div>
          <p>{result.comparison}</p>
          <p className="preferred">{result.preferred}</p>
        </section>
      </section>
    )
  }

  return (
    <section className="result-grid">
      <SummaryCard title="Compiled result" summary={result.summary} />
      <section className="panel narrative">
        <div className="panel-label">
          {result.mode === 'design' ? 'Design rationale' : 'Inspection notes'}
        </div>
        <p>{result.explanation}</p>
        <ul className="cautions">
          {result.cautions.map((caution) => (
            <li key={caution}>{caution}</li>
          ))}
        </ul>
      </section>
    </section>
  )
}

function SummaryCard({ title, summary }: { title: string; summary: ScriptSummary }) {
  return (
    <section className="panel summary-card">
      <div className="panel-label">{title}</div>
      <h2>{summary.kind === 'policy' ? 'Policy compiled' : 'Miniscript analyzed'}</h2>
      <div className="chip-row">
        <span>{summary.context}</span>
        <span>valid: {String(summary.valid)}</span>
        <span>sane: {String(summary.sane)}</span>
        <span>non-malleable: {String(summary.nonMalleable)}</span>
      </div>

      <CodeBlock title="Input" code={summary.normalizedInput} />
      <CodeBlock title="Miniscript" code={summary.miniscript} />
      <CodeBlock title="ASM" code={summary.asm || '[no asm output]'} />

      {summary.mermaid ? (
        <>
          <FlowchartCard chart={summary.mermaid} />
          <CodeBlock title="Mermaid source" code={summary.mermaid} />
        </>
      ) : null}

      <section className="witness-grid">
        <WitnessList
          title="Non-malleable satisfactions"
          items={summary.satisfactions.nonMalleable}
        />
        <WitnessList
          title="Malleable satisfactions"
          items={summary.satisfactions.malleable}
        />
      </section>

      {summary.error ? <p className="error">{summary.error}</p> : null}
    </section>
  )
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="code-block">
      <div className="block-label">{title}</div>
      <pre>{code}</pre>
    </div>
  )
}

function WitnessList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="witness-list">
      <div className="block-label">{title}</div>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>
              <code>{item}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-list">None surfaced for this expression.</p>
      )}
    </div>
  )
}

function FlowchartCard({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const graphId = useId().replaceAll(':', '_')

  useEffect(() => {
    let active = true
    async function render() {
      if (!containerRef.current) {
        return
      }
      const mermaid = (await import('mermaid')).default
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          primaryColor: '#d5b06f',
          primaryTextColor: '#1b140c',
          primaryBorderColor: '#8e6c2e',
          lineColor: '#d9c7a3',
          secondaryColor: '#efe1c5',
          tertiaryColor: '#0f0c08',
          fontFamily: 'IBM Plex Mono',
        },
      })
      const { svg } = await mermaid.render(`mermaid_${graphId}`, chart)
      if (active && containerRef.current) {
        containerRef.current.innerHTML = svg
      }
    }
    void render()
    return () => {
      active = false
    }
  }, [chart, graphId])

  return (
    <div className="flowchart-card">
      <div className="block-label">Flowchart preview</div>
      <div ref={containerRef} className="flowchart-preview" />
    </div>
  )
}

export default App
