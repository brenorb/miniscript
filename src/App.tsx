import {
  startTransition,
  useEffect,
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
import { buildOffTopicReply, evaluateScope } from './lib/assistantScope'
import { formatUnknownError } from './lib/formatUnknownError'
import type { CompileContext, ScriptSummary } from './lib/miniscriptTooling'

type RunState = 'idle' | 'loading-model' | 'running' | 'error'

type ConversationTurn = {
  id: string
  request: AssistantRequest
  result: AssistantResult
}

const STARTERS = {
  design: [
    'Design a family recovery script where any two of Alice, Bob, and Carol can spend.',
    'Create a 2FA wallet where the user and service sign together, but after roughly 90 days the user can recover alone.',
    'Design a vault path where a hot key signs plus a hash preimage, or a 2-of-3 cold backup with Alice, Bob, and Carol.',
  ],
  inspect: [
    'or(pk(Alice),and(pk(Bob),older(144)))',
    'thresh(2,pk(Alice),pk(Bob),pk(Carol))',
    'and(pk(user),or(99@pk(service),older(12960)))',
  ],
  compare: [
    {
      left: 'thresh(2,pk(Alice),pk(Bob),pk(Carol))',
      right: 'or(and(pk(Alice),pk(Bob)),and(pk(Carol),after(900000)))',
    },
    {
      left: 'or(pk(Alice),and(pk(Bob),older(144)))',
      right: 'or(and(pk(Alice),older(144)),pk(Bob))',
    },
  ],
} as const

function App() {
  const [modelId, setModelId] = useState<SupportedModelId>(supportedModels[0].id)
  const [mode, setMode] = useState<'design' | 'inspect' | 'compare'>('design')
  const [context, setContext] = useState<CompileContext>('p2wsh')
  const [prompt, setPrompt] = useState<string>(STARTERS.design[0])
  const [leftPrompt, setLeftPrompt] = useState<string>(STARTERS.compare[0].left)
  const [rightPrompt, setRightPrompt] = useState<string>(STARTERS.compare[0].right)
  const [runState, setRunState] = useState<RunState>('idle')
  const [progress, setProgress] = useState<AssistantProgress | null>(null)
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [quickSummary, setQuickSummary] = useState<ScriptSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const conversationEndRef = useRef<HTMLDivElement | null>(null)
  const assistantRef = useRef<{
    modelId: SupportedModelId
    run: (request: AssistantRequest) => Promise<AssistantResult>
  } | null>(null)

  const currentModel =
    supportedModels.find((model) => model.id === modelId) ?? supportedModels[0]

  const handleProgress = (nextProgress: AssistantProgress) => {
    setProgress(nextProgress)
  }

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, progress])

  useEffect(() => {
    const source = getPreviewSource(mode, prompt, leftPrompt)
    if (!source) {
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
    }, 180)

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

  function buildRequest(): AssistantRequest {
    if (mode === 'compare') {
      return {
        mode,
        left: leftPrompt,
        right: rightPrompt,
        context,
      }
    }

    return {
      mode,
      prompt,
      context,
    }
  }

  async function runAssistant() {
    setError(null)
    setProgress(null)

    const request = buildRequest()
    const scope = evaluateScope(request)
    setRunState('running')

    try {
      const result = !scope.inScope
        ? buildOffTopicReply(scope)
        : await (await ensureAssistant()).run(request)

      startTransition(() => {
        setTurns((previous) => [
          ...previous,
          {
            id: crypto.randomUUID(),
            request,
            result,
          },
        ])
      })
      setRunState('idle')
    } catch (caught) {
      setRunState('error')
      setError(formatUnknownError(caught))
    }
  }

  const latestStructuredTurn = [...turns]
    .reverse()
    .find((turn) => turn.result.mode !== 'guardrail')
  const visibleQuickSummary = getPreviewSource(mode, prompt, leftPrompt)
    ? quickSummary
    : null

  return (
    <div className="app-shell">
      <aside className="panel sidebar">
        <div className="brand-lockup">
          <div className="brand-kicker">Local Miniscript</div>
          <h1>Chat, compile, inspect.</h1>
          <p>
            Ax handles the prompting. The compiler and analyzer decide what is
            actually valid.
          </p>
        </div>

        <section className="stack">
          <div className="section-label">Mode</div>
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
        </section>

        <section className="stack">
          <div className="section-label">Runtime</div>
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
          <p className="meta-note">{currentModel.note}</p>
        </section>

        <section className="stack">
          <div className="section-label">Starter prompts</div>
          {mode === 'compare' ? (
            <div className="starter-list">
              {STARTERS.compare.map((starter) => (
                <button
                  key={starter.left + starter.right}
                  type="button"
                  className="starter-card"
                  onClick={() => {
                    setLeftPrompt(starter.left)
                    setRightPrompt(starter.right)
                  }}
                >
                  <strong>Compare pair</strong>
                  <span>{starter.left}</span>
                  <span>{starter.right}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="starter-list">
              {STARTERS[mode].map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="starter-card"
                  onClick={() => setPrompt(starter)}
                >
                  <span>{starter}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </aside>

      <main className="chat-column">
        <header className="panel chat-header">
          <div>
            <div className="section-label">Workspace</div>
            <h2>Miniscript assistant</h2>
          </div>
          <div className="header-status">
            {progress ? (
              <>
                <strong>{progress.stage}</strong>
                <span>{progress.detail}</span>
              </>
            ) : (
              <>
                <strong>compiler guardrail</strong>
                <span>Every structured answer is compiled before display.</span>
              </>
            )}
          </div>
        </header>

        <section className="panel conversation">
          {turns.length === 0 ? <EmptyConversation mode={mode} /> : null}

          {turns.map((turn) => (
            <ConversationTurnView key={turn.id} turn={turn} />
          ))}

          {runState === 'running' || runState === 'loading-model' ? (
            <article className="message assistant">
              <div className="message-badge">assistant</div>
              <div className="message-card working-card">
                <p>
                  {runState === 'loading-model'
                    ? 'Loading the local model.'
                    : 'Running the prompt through the assistant and compiler.'}
                </p>
              </div>
            </article>
          ) : null}

          <div ref={conversationEndRef} />
        </section>

        <section className="panel composer">
          <div className="composer-header">
            <div>
              <div className="section-label">Prompt</div>
              <h3>{mode === 'design' ? 'Describe the spending policy you want.' : mode === 'inspect' ? 'Paste a policy or miniscript expression.' : 'Compare two constructions.'}</h3>
            </div>
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
                  : 'Send'}
            </button>
          </div>

          {mode === 'compare' ? (
            <div className="compare-fields">
              <label>
                <span>Candidate A</span>
                <textarea
                  value={leftPrompt}
                  onChange={(event) => setLeftPrompt(event.target.value)}
                  rows={4}
                />
              </label>
              <label>
                <span>Candidate B</span>
                <textarea
                  value={rightPrompt}
                  onChange={(event) => setRightPrompt(event.target.value)}
                  rows={4}
                />
              </label>
            </div>
          ) : (
            <label>
              <span>{mode === 'design' ? 'Intent' : 'Expression'}</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
              />
            </label>
          )}

          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>

      <aside className="panel inspector">
        <div className="section-label">Inspector</div>
        {visibleQuickSummary ? (
          <InspectorSummary
            title="Draft compiler check"
            summary={visibleQuickSummary}
            emphasizeInput
          />
        ) : latestStructuredTurn ? (
          <LatestResultInspector turn={latestStructuredTurn} />
        ) : (
          <p className="empty-copy">
            The right rail shows a live compiler check for policy-shaped input,
            then falls back to the latest compiled answer.
          </p>
        )}
      </aside>
    </div>
  )
}

function EmptyConversation({ mode }: { mode: 'design' | 'inspect' | 'compare' }) {
  return (
    <div className="empty-chat">
      <div className="section-label">Ready</div>
      <h3>Start with the prompt box, not a landing page.</h3>
      <p>
        {mode === 'design'
          ? 'Describe the spending intent and the assistant will draft a policy, compile it, and show the resulting structure.'
          : mode === 'inspect'
            ? 'Paste an existing policy or miniscript and the app will explain it after a real compiler/analyzer pass.'
            : 'Drop two candidates side by side and the assistant will compare the tradeoffs after compiling both.'}
      </p>
    </div>
  )
}

function ConversationTurnView({ turn }: { turn: ConversationTurn }) {
  return (
    <>
      <article className="message user">
        <div className="message-badge">you</div>
        <div className="message-card">
          <RequestPreview request={turn.request} />
        </div>
      </article>

      <article className="message assistant">
        <div className="message-badge">assistant</div>
        <div className="message-card">
          <ResultView result={turn.result} />
        </div>
      </article>
    </>
  )
}

function RequestPreview({ request }: { request: AssistantRequest }) {
  if (request.mode === 'compare') {
    return (
      <div className="request-grid">
        <div>
          <div className="section-label">Candidate A</div>
          <pre>{request.left}</pre>
        </div>
        <div>
          <div className="section-label">Candidate B</div>
          <pre>{request.right}</pre>
        </div>
      </div>
    )
  }

  return <p>{request.prompt}</p>
}

function ResultView({ result }: { result: AssistantResult }) {
  if (result.mode === 'guardrail') {
    return (
      <div className="result-stack">
        <p>{result.message}</p>
        <ul className="suggestion-list">
          {result.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      </div>
    )
  }

  if (result.mode === 'compare') {
    return (
      <div className="result-stack">
        <p>{result.comparison}</p>
        <p className="preferred">{result.preferred}</p>
        <div className="compare-summary-grid">
          <CompactSummary title="Candidate A" summary={result.left} />
          <CompactSummary title="Candidate B" summary={result.right} />
        </div>
      </div>
    )
  }

  return (
    <div className="result-stack">
      <p>{result.explanation}</p>
      <CompactSummary
        title={result.mode === 'design' ? 'Compiled result' : 'Inspection result'}
        summary={result.summary}
      />
      {result.summary.mermaid ? <FlowchartCard chart={result.summary.mermaid} /> : null}
      <details className="details-block">
        <summary>Show compiled output</summary>
        <div className="details-grid">
          <CodeBlock title="Input" code={result.summary.normalizedInput} />
          <CodeBlock title="Miniscript" code={result.summary.miniscript} />
          <CodeBlock title="ASM" code={result.summary.asm || '[no asm output]'} />
        </div>
      </details>
      {result.cautions.length > 0 ? (
        <ul className="caution-list">
          {result.cautions.map((caution) => (
            <li key={caution}>{caution}</li>
          ))}
        </ul>
      ) : null}
      {result.summary.error ? <p className="error subtle">{result.summary.error}</p> : null}
    </div>
  )
}

function CompactSummary({
  title,
  summary,
}: {
  title: string
  summary: ScriptSummary
}) {
  return (
    <section className="summary-card">
      <div className="summary-head">
        <strong>{title}</strong>
        <span>{summary.context}</span>
      </div>
      <div className="metric-row">
        <span>valid {String(summary.valid)}</span>
        <span>sane {String(summary.sane)}</span>
        <span>non-malleable {String(summary.nonMalleable)}</span>
      </div>
      <pre>{summary.miniscript}</pre>
    </section>
  )
}

function LatestResultInspector({ turn }: { turn: ConversationTurn }) {
  if (turn.result.mode === 'guardrail') {
    return <p className="empty-copy">{turn.result.message}</p>
  }

  if (turn.result.mode === 'compare') {
    return (
      <div className="inspector-stack">
        <InspectorSummary title="Candidate A" summary={turn.result.left} />
        <InspectorSummary title="Candidate B" summary={turn.result.right} />
      </div>
    )
  }

  return <InspectorSummary title="Latest answer" summary={turn.result.summary} />
}

function InspectorSummary({
  title,
  summary,
  emphasizeInput = false,
}: {
  title: string
  summary: ScriptSummary
  emphasizeInput?: boolean
}) {
  return (
    <div className="inspector-stack">
      <div className="summary-head">
        <strong>{title}</strong>
        <span>{summary.kind}</span>
      </div>
      <div className="metric-row">
        <span>valid {String(summary.valid)}</span>
        <span>sane {String(summary.sane)}</span>
        <span>needs sig {String(summary.needsSignature)}</span>
      </div>
      <CodeBlock
        title={emphasizeInput ? 'Draft input' : 'Input'}
        code={summary.normalizedInput}
      />
      <CodeBlock title="Miniscript" code={summary.miniscript} />
      <CodeBlock title="ASM" code={summary.asm || '[no asm output]'} />
      {summary.mermaid ? <FlowchartCard chart={summary.mermaid} /> : null}
      <WitnessList
        title="Non-malleable satisfactions"
        items={summary.satisfactions.nonMalleable}
      />
      {summary.error ? <p className="error subtle">{summary.error}</p> : null}
    </div>
  )
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="code-block">
      <div className="section-label">{title}</div>
      <pre>{code}</pre>
    </div>
  )
}

function WitnessList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="witness-list">
      <div className="section-label">{title}</div>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>
              <code>{item}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-copy">No non-malleable witnesses surfaced.</p>
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
          background: '#11151c',
          primaryColor: '#d6c6a2',
          primaryTextColor: '#263144',
          primaryBorderColor: '#8e8268',
          lineColor: '#a6acb8',
          secondaryColor: '#efe7d5',
          secondaryTextColor: '#263144',
          tertiaryColor: '#1a202a',
          tertiaryTextColor: '#263144',
          textColor: '#263144',
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
      <div className="section-label">Flowchart</div>
      <div ref={containerRef} className="flowchart-preview" />
    </div>
  )
}

function getPreviewSource(
  mode: 'design' | 'inspect' | 'compare',
  prompt: string,
  leftPrompt: string,
) {
  if (mode === 'inspect') {
    return prompt.trim()
  }
  if (mode === 'compare') {
    return leftPrompt.trim()
  }
  return /\b(?:pk|after|older|sha256|hash256|ripemd160|hash160|and|or|thresh)\s*\(/i.test(
    prompt,
  )
    ? prompt.trim()
    : ''
}

export default App
