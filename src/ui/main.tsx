import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/foundation.css';
import './styles/table.css';
import './styles/review.css';
import './styles/shell-history.css';
import './styles/report-page.css';
import './styles/review-page.css';
import './styles/settings-hand-ranks.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root 挂载点');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
