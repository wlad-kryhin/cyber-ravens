import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const LABEL = 'find the bug'

export default function BugSearchField() {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)

  return (
    <motion.div
      className="search-container"
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

      <div className={`search-field ${focused ? 'search-field--focused' : ''}`}>
        <motion.span
          className="field-icon"
          animate={{ rotate: focused ? 360 : 0 }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
        >
          ◈
        </motion.span>

        <input
          id="bug-search"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="trace the anomaly..."
          autoComplete="off"
          spellCheck={false}
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
      </div>

      <motion.div
        className="search-underline"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: focused ? 1 : 0.3 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.div>
  )
}
