import AnimatedBackground from './components/AnimatedBackground'
import BugSearchField from './components/BugSearchField'
import './App.css'

function App() {
  return (
    <div className="app">
      <AnimatedBackground />
      <main className="main">
        <BugSearchField />
      </main>
    </div>
  )
}

export default App
