import { motion, AnimatePresence } from 'framer-motion'
import idleLogo from '../assets/logo-idle.png'
import thinkingRaven from '../assets/thinkingraven.png'
import talkingRaven from '../assets/cyber_ravens_talking.gif'

export type RavenMood = 'idle' | 'thinking' | 'talking'

interface AnimatedLogoProps {
  mood?: RavenMood
}

const RAVEN_SRC: Record<RavenMood, string> = {
  idle: idleLogo,
  thinking: thinkingRaven,
  talking: talkingRaven,
}

export default function AnimatedLogo({ mood = 'idle' }: AnimatedLogoProps) {
  return (
    <motion.header
      className="logo"
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <AnimatePresence mode="wait">
        <motion.img
          key={mood}
          src={RAVEN_SRC[mood]}
          alt="Cyber Ravens"
          className={`logo-image logo-image--${mood}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        />
      </AnimatePresence>
    </motion.header>
  )
}
