import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root 挂载点');

createRoot(root).render(
  <StrictMode>
    <div style={{ padding: 16 }}>脚手架就绪</div>
  </StrictMode>,
);
