import AnimatedBackground from './components/AnimatedBackground'
import AnimatedLogo from './components/AnimatedLogo'
import BugSearchField from './components/BugSearchField'
import FlyingTalentechLogos from './components/FlyingTalentechLogos'
import './App.css'

function App() {
  return (
    <div className="app">
      <AnimatedBackground />
      <FlyingTalentechLogos />
      <AnimatedLogo />
      <main className="main">
        <BugSearchField />
      </main>
    </div>
  )
}

export default App
