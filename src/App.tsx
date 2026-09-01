import { useState } from 'react'
import AnimatedBackground from './components/AnimatedBackground'
import AnimatedLogo, { type RavenMood } from './components/AnimatedLogo'
import BugSearchField from './components/BugSearchField'
import FlyingTalentechLogos from './components/FlyingTalentechLogos'
import './App.css'

function App() {
  const [ravenMood, setRavenMood] = useState<RavenMood>('idle')

  return (
    <div className="app">
      <AnimatedBackground />
      <FlyingTalentechLogos />
      <AnimatedLogo mood={ravenMood} />
      <main className="main">
        <BugSearchField onRavenMoodChange={setRavenMood} />
      </main>
    </div>
  )
}

export default App
