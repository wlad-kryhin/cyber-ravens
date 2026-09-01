import { motion } from 'framer-motion'

const PARTICLES = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: Math.random() * 3 + 1,
  duration: Math.random() * 20 + 15,
  delay: Math.random() * 5,
}))

function Raven({ x, delay }: { x: number; delay: number }) {
  return (
    <motion.svg
      className="raven"
      viewBox="0 0 64 32"
      initial={{ x: `${x}vw`, y: '-10vh', opacity: 0 }}
      animate={{
        x: [`${x}vw`, `${x + 15}vw`, `${x + 30}vw`],
        y: ['-10vh', '30vh', '110vh'],
        opacity: [0, 0.6, 0],
      }}
      transition={{
        duration: 18,
        delay,
        repeat: Infinity,
        ease: 'linear',
      }}
    >
      <path
        d="M4 20 C12 8, 28 4, 40 10 C48 14, 52 18, 60 16 L58 20 C50 24, 42 22, 36 18 C28 12, 16 14, 8 22 Z"
        fill="currentColor"
      />
    </motion.svg>
  )
}

export default function AnimatedBackground() {
  return (
    <div className="background" aria-hidden="true">
      <div className="grid-overlay" />
      <div className="gradient-orb gradient-orb--purple" />
      <div className="gradient-orb gradient-orb--cyan" />

      {PARTICLES.map((p) => (
        <motion.span
          key={p.id}
          className="particle"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [0, -30, 0],
            opacity: [0.2, 0.8, 0.2],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}

      <Raven x={-5} delay={0} />
      <Raven x={30} delay={8} />
      <Raven x={60} delay={14} />

      <div className="scanline" />
    </div>
  )
}
