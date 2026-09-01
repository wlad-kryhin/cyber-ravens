import { motion } from 'framer-motion'

type LogoVariant = 'mark' | 'wordmark'

interface FlyingLogoConfig {
  id: number
  variant: LogoVariant
  startX: number
  startY: number
  endX: number
  endY: number
  size: number
  duration: number
  delay: number
  rotate: number
}

const FLYING_LOGOS: FlyingLogoConfig[] = [
  { id: 1, variant: 'mark', startX: -8, startY: 15, endX: 108, endY: 55, size: 36, duration: 28, delay: 0, rotate: 12 },
  { id: 2, variant: 'wordmark', startX: 110, startY: 20, endX: -15, endY: 65, size: 72, duration: 34, delay: 4, rotate: -8 },
  { id: 3, variant: 'mark', startX: -6, startY: 70, endX: 106, endY: 25, size: 28, duration: 32, delay: 9, rotate: -15 },
  { id: 4, variant: 'wordmark', startX: 105, startY: 75, endX: -12, endY: 30, size: 64, duration: 38, delay: 14, rotate: 10 },
  { id: 5, variant: 'mark', startX: 50, startY: -10, endX: 55, endY: 110, size: 32, duration: 26, delay: 6, rotate: 20 },
  { id: 6, variant: 'wordmark', startX: -10, startY: 45, endX: 112, endY: 40, size: 56, duration: 42, delay: 18, rotate: -5 },
]

const MARK_SRC = '/talentech-primary.svg'
const WORDMARK_SRC = '/talentech-logo.svg'

function FlyingLogo({ config }: { config: FlyingLogoConfig }) {
  const src = config.variant === 'mark' ? MARK_SRC : WORDMARK_SRC

  return (
    <motion.img
      src={src}
      alt=""
      aria-hidden="true"
      className={`flying-talentech flying-talentech--${config.variant}`}
      style={{
        width: config.variant === 'mark' ? config.size : config.size * 2.2,
        height: config.variant === 'mark' ? config.size : config.size * 0.32,
      }}
      initial={{
        x: `${config.startX}vw`,
        y: `${config.startY}vh`,
        opacity: 0,
        rotate: config.rotate,
      }}
      animate={{
        x: [`${config.startX}vw`, `${config.endX}vw`],
        y: [`${config.startY}vh`, `${config.endY}vh`],
        opacity: [0, 0.22, 0.18, 0],
        rotate: [config.rotate, config.rotate + 8, config.rotate - 4, config.rotate],
      }}
      transition={{
        duration: config.duration,
        delay: config.delay,
        repeat: Infinity,
        ease: 'linear',
      }}
    />
  )
}

export default function FlyingTalentechLogos() {
  return (
    <div className="flying-talentech-layer" aria-hidden="true">
      {FLYING_LOGOS.map((config) => (
        <FlyingLogo key={config.id} config={config} />
      ))}
    </div>
  )
}
