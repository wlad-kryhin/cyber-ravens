import { motion } from 'framer-motion'

const CYBER_RAVENS = 'cyber ravens'
const TALENTECH_LOGO = '/talentech-logo.svg'

export default function AnimatedLogo() {
  return (
    <motion.header
      className="logo"
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        className="logo-glow"
        animate={{ opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="logo-text">
        <motion.img
          src={TALENTECH_LOGO}
          alt="Talentech"
          className="logo-wordmark"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: [0, -2, 0] }}
          transition={{
            opacity: { delay: 0.2, duration: 0.5 },
            y: { duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.6 },
          }}
        />

        <motion.span
          className="logo-divider"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        />

        <motion.span
          className="logo-title"
          aria-label={CYBER_RAVENS}
          animate={{
            filter: [
              'drop-shadow(0 0 6px rgba(6,182,212,0.5)) drop-shadow(0 0 14px rgba(139,92,246,0.35))',
              'drop-shadow(0 0 10px rgba(6,182,212,0.85)) drop-shadow(0 0 22px rgba(139,92,246,0.55))',
              'drop-shadow(0 0 6px rgba(6,182,212,0.5)) drop-shadow(0 0 14px rgba(139,92,246,0.35))',
            ],
          }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          {CYBER_RAVENS.split('').map((char, i) => (
            <motion.span
              key={`${char}-${i}`}
              className={char === ' ' ? 'logo-title__space' : 'logo-title__char'}
              initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }}
              animate={{
                opacity: 1,
                y: [0, -2, 0],
                filter: 'blur(0px)',
              }}
              transition={{
                opacity: { delay: 0.5 + i * 0.05, duration: 0.35 },
                y: {
                  delay: 0.9 + i * 0.08,
                  duration: 2.8,
                  repeat: Infinity,
                  ease: 'easeInOut',
                },
                filter: { delay: 0.5 + i * 0.05, duration: 0.35 },
              }}
            >
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
        </motion.span>
      </div>

      <motion.span
        className="logo-scan"
        animate={{ x: ['-120%', '220%'] }}
        transition={{ duration: 3, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }}
      />
    </motion.header>
  )
}
