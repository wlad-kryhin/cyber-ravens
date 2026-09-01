import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { askJira } from '../services/jiraApi'
import type { RavenMood } from './AnimatedLogo'
import AskAnswer, { type ChatTurnView } from './AskAnswer'

const LABEL = 'Ask the Raven'
const MIN_QUERY_LENGTH = 2
const LOADING_STEPS = [
  'Breaking down the question…',
  'Searching Jira and Confluence…',
  'Formulating an answer…',
]

interface BugSearchFieldProps {
  onRavenMoodChange?: (mood: RavenMood) => void
}

export default function BugSearchField({ onRavenMoodChange }: BugSearchFieldProps) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [turns, setTurns] = useState<ChatTurnView[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [farewell, setFarewell] = useState(false)
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
      .map((turn) => ({
        question: turn.question,
        answer: turn.answer,
        queries: turn.queries,
        timeLabel: turn.timeLabel,
        products: [...new Set(turn.tasks.map((task) => task.product).filter(Boolean))],
        issueKeys: turn.tasks.map((task) => task.id),
        docTitles: turn.docs.map((doc) => doc.title),
      }))
    const turnId = `${Date.now()}-${turns.length}`

    setLoading(true)
    setLoadingStep(0)
    setError(null)
    onRavenMoodChange?.('thinking')
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
        docs: [],
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
                docs: result.docs,
                pending: false,
              }
            : turn,
        ),
      )
    } catch (err) {
      setTurns((current) => current.filter((turn) => turn.id !== turnId))
      setValue(nextQuestion)
      setError(err instanceof Error ? err.message : 'Failed to ask Jira')
      onRavenMoodChange?.('idle')
    } finally {
      setLoading(false)
    }
  }

  function handleNewQuestion() {
    setValue('')
    setTurns([])
    setError(null)
    setLoading(false)
    setFarewell(false)
    onRavenMoodChange?.('idle')
    inputRef.current?.focus()
  }

  const handleThanks = useCallback(() => {
    setFarewell(true)
  }, [])

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
        {inConversation && !farewell && (
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
                onRavenMoodChange={
                  index === turns.length - 1 ? onRavenMoodChange : undefined
                }
                onThanks={
                  index === turns.length - 1 && !turn.pending ? handleThanks : undefined
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
                : 'Ask about a system, change, or issue…'
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

      {createPortal(
        <AnimatePresence>
          {farewell && (
            <motion.div
              className="raven-farewell"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              <motion.p
                className="raven-farewell__message"
                initial={{ opacity: 0, scale: 0.92, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                The raven have spoken, go in peace
              </motion.p>
              <motion.button
                type="button"
                className="new-question-btn new-question-btn--farewell"
                onClick={handleNewQuestion}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.45 }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
              >
                Ask a new question
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </motion.div>
  )
}
