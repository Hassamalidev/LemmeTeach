/**
 * Entry point.
 *
 * No router, no providers, no store — a handful of screens held in React
 * state, which is what keeps the build working at any path (§15).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import './styles/board.css';
import 'katex/dist/katex.min.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
