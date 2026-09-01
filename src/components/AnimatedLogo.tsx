import { motion } from 'framer-motion'
import appLogo from '../assets/logo.png'

export default function AnimatedLogo() {
  return (
    <motion.header
      className="logo"
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.img
        src={appLogo}
        alt="Cyber Ravens"
        className="logo-image"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{
          opacity: 1,
          scale: 1,
          y: [0, -3, 0],
        }}
        transition={{
          opacity: { delay: 0.15, duration: 0.5 },
          scale: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
          y: { duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 },
        }}
      />
    </motion.header>
  )
}
