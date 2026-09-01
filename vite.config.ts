import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { jiraApiPlugin } from './server/jira.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), jiraApiPlugin()],
})
