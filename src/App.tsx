import { useState } from 'react'
import AnimatedBackground from './components/AnimatedBackground'
import AnimatedLogo from './components/AnimatedLogo'
import BugSearchField from './components/BugSearchField'
import FlyingTalentechLogos from './components/FlyingTalentechLogos'
import './App.css'

function App() {
  const [talking, setTalking] = useState(false)

  return (
    <div className="app">
      <AnimatedBackground />
      <FlyingTalentechLogos />
      <AnimatedLogo talking={talking} />
      <main className="main">
        <BugSearchField onTalkingChange={setTalking} />
      </main>
    </div>
  )
}

export default App
