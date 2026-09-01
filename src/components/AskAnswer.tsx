import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { BugTask } from '../data/bugTasks'
import BugTaskList from './BugTaskList'

export interface ChatTurnView {
  id: string
  question: string
  answer: string
  queries: string[]
  timeLabel: string | null
  tasks: BugTask[]
  pending?: boolean
}

interface AskAnswerProps {
  turn: ChatTurnView
  onProgress?: () => void
  onTalkingChange?: (talking: boolean) => void
}

const CHARS_PER_TICK = 2
const TICK_MS = 24
const TALKING_HOLD_MS = 2200

export default function AskAnswer({ turn, onProgress, onTalkingChange }: AskAnswerProps) {
  return (
    <motion.article
      className="chat-turn"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="chat-turn__question">{turn.question}</p>

      {turn.pending ? (
        <p className="chat-turn__pending">Looking through Jira…</p>
      ) : (
        <TypedAnswer
          key={`${turn.id}-${turn.answer}`}
          turn={turn}
          onProgress={onProgress}
          onTalkingChange={onTalkingChange}
        />
      )}
    </motion.article>
  )
}

function TypedAnswer({ turn, onProgress, onTalkingChange }: AskAnswerProps) {
  const [count, setCount] = useState(0)
  const [talking, setTalking] = useState(true)
  const visible = turn.answer.slice(0, count)
  const typing = count < turn.answer.length

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCount((current) => {
        const next = Math.min(turn.answer.length, current + CHARS_PER_TICK)
        if (next >= turn.answer.length) window.clearInterval(timer)
        return next
      })
    }, TICK_MS)

    return () => window.clearInterval(timer)
  }, [turn.answer])

  useEffect(() => {
    if (typing) return

    const hold = window.setTimeout(() => setTalking(false), TALKING_HOLD_MS)
    return () => window.clearTimeout(hold)
  }, [typing])

  useEffect(() => {
    onProgress?.()
  }, [count, onProgress])

  useEffect(() => {
    onTalkingChange?.(talking)
    return () => onTalkingChange?.(false)
  }, [talking, onTalkingChange])

  return (
    <>
      <p className="chat-turn__answer">
        {visible}
        {typing && <span className="chat-turn__caret" />}
      </p>

      {!typing && (
        <>
          {(turn.queries.length > 0 || turn.timeLabel) && (
            <p className="ask-answer__queries">
              <span>Searched Jira for</span>
              {turn.queries.map((query) => (
                <span key={query} className="ask-answer__chip">
                  {query}
                </span>
              ))}
              {turn.timeLabel && (
                <span className="ask-answer__chip ask-answer__chip--time">{turn.timeLabel}</span>
              )}
            </p>
          )}
          <BugTaskList
            tasks={turn.tasks}
            query={turn.question}
            header={
              turn.tasks.length > 0
                ? `${turn.tasks.length} related Jira issue${turn.tasks.length !== 1 ? 's' : ''}`
                : undefined
            }
          />
        </>
      )}
    </>
  )
}
