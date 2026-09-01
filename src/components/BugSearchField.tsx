import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { askJira } from '../services/jiraApi'
import AskAnswer, { type ChatTurnView } from './AskAnswer'

const LABEL = 'Ask the Raven'
const MIN_QUERY_LENGTH = 2
const LOADING_STEPS = [
  'Breaking down the question…',
  'Searching Jira…',
  'Formulating an answer…',
]

interface BugSearchFieldProps {
  onTalkingChange?: (talking: boolean) => void
}

export default function BugSearchField({ onTalkingChange }: BugSearchFieldProps) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [turns, setTurns] = useState<ChatTurnView[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!loading) return

    const timer = window.setInterval(() => {
      setLoadingStep((step) => (step + 1) % LOADING_STEPS.length)
    }, 1400)

    return () => window.clearInterval(timer)
  }, [loading])

  const scrollThread = useCallback(() => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollThread()
  }, [turns, loading, scrollThread])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextQuestion = value.trim()
    if (nextQuestion.length < MIN_QUERY_LENGTH || loading) return

    const history = turns
      .filter((turn) => turn.answer)
      .map((turn) => ({ question: turn.question, answer: turn.answer }))
    const turnId = `${Date.now()}-${turns.length}`

    setLoading(true)
    setLoadingStep(0)
    setError(null)
    setValue('')
    setTurns((current) => [
      ...current,
      {
        id: turnId,
        question: nextQuestion,
        answer: '',
        queries: [],
        timeLabel: null,
        tasks: [],
        pending: true,
      },
    ])

    try {
      const result = await askJira(nextQuestion, history)
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                answer: result.answer,
                queries: result.queries,
                timeLabel: result.timeLabel,
                tasks: result.tasks,
                pending: false,
              }
            : turn,
        ),
      )
    } catch (err) {
      setTurns((current) => current.filter((turn) => turn.id !== turnId))
      setValue(nextQuestion)
      setError(err instanceof Error ? err.message : 'Failed to ask Jira')
    } finally {
      setLoading(false)
    }
  }

  function handleNewQuestion() {
    setValue('')
    setTurns([])
    setError(null)
    setLoading(false)
    onTalkingChange?.(false)
    inputRef.current?.focus()
  }

  const inConversation = turns.length > 0

  return (
    <motion.div
      className={`search-container${inConversation ? ' search-container--chat' : ''}`}
      initial={{ opacity: 0, y: 40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        className="search-glow"
        animate={{
          opacity: focused ? 1 : 0.4,
          scale: focused ? 1.05 : 1,
        }}
        transition={{ duration: 0.4 }}
      />

      <label htmlFor="bug-search" className="search-label">
        {LABEL.split('').map((char, i) => (
          <motion.span
            key={`${char}-${i}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.4 + i * 0.04,
              duration: 0.4,
              ease: 'easeOut',
            }}
            className={char === ' ' ? 'space' : undefined}
          >
            {char === ' ' ? '\u00A0' : char}
          </motion.span>
        ))}
        <motion.span
          className="label-cursor"
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      </label>

      <AnimatePresence>
        {inConversation && (
          <motion.button
            type="button"
            className="new-question-btn"
            onClick={handleNewQuestion}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Ask a new question
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {inConversation && (
          <motion.div
            ref={threadRef}
            className="chat-thread"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {turns.map((turn, index) => (
              <AskAnswer
                key={turn.id}
                turn={turn}
                onProgress={scrollThread}
                onTalkingChange={
                  index === turns.length - 1 ? onTalkingChange : undefined
                }
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <form className="search-form" onSubmit={handleSubmit}>
        <div className={`search-field ${focused ? 'search-field--focused' : ''}`}>
          <motion.span
            className="field-icon"
            animate={{ rotate: focused ? 360 : 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            ◈
          </motion.span>

          <input
            ref={inputRef}
            id="bug-search"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={
              inConversation
                ? 'Ask a follow-up…'
                : 'Have we changed Varbi login the last month?'
            }
            autoComplete="off"
            spellCheck={false}
            disabled={loading}
          />

          <AnimatePresence>
            {value.length > 0 && (
              <motion.button
                type="button"
                className="clear-btn"
                onClick={() => setValue('')}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                aria-label="Clear input"
              >
                ×
              </motion.button>
            )}
          </AnimatePresence>

          <motion.button
            type="submit"
            className="ask-btn"
            disabled={loading || value.trim().length < MIN_QUERY_LENGTH}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            Ask
          </motion.button>
        </div>
      </form>

      <motion.div
        className="search-underline"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: focused ? 1 : 0.3 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      />

      {loading && <p className="task-list__status">{LOADING_STEPS[loadingStep]}</p>}
      {error && <p className="task-list__error">{error}</p>}
    </motion.div>
  )
}
