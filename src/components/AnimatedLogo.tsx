import { motion, AnimatePresence } from 'framer-motion'
import appLogo from '../assets/logo.png'
import talkingRaven from '../assets/cyber_ravens_talking.gif'

interface AnimatedLogoProps {
  talking?: boolean
}

export default function AnimatedLogo({ talking = false }: AnimatedLogoProps) {
  return (
    <motion.header
      className="logo"
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <AnimatePresence mode="wait">
        {talking ? (
          <motion.img
            key="talking"
            src={talkingRaven}
            alt="Cyber Ravens"
            className="logo-image logo-image--talking"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
          />
        ) : (
          <motion.img
            key="idle"
            src={appLogo}
            alt="Cyber Ravens"
            className="logo-image"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: [0, -3, 0],
            }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{
              opacity: { duration: 0.2 },
              scale: { duration: 0.25 },
              y: { duration: 3.5, repeat: Infinity, ease: 'easeInOut' },
            }}
          />
        )}
      </AnimatePresence>
    </motion.header>
  )
}
