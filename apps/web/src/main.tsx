import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { createEnvironment } from './environment'
import './index.css'

const root = createRoot(document.getElementById('root')!)

void createEnvironment().then((env) => {
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App env={env} />
      </BrowserRouter>
    </StrictMode>,
  )
})
