import { motion, AnimatePresence } from 'framer-motion'
import idleLogo from '../assets/logo-idle.png'
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        ) : (
          <motion.img
            key="idle"
            src={idleLogo}
            alt="Cyber Ravens"
            className="logo-image"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        )}
      </AnimatePresence>
    </motion.header>
  )
}
