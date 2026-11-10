import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const isElectron = /Electron/i.test(navigator.userAgent) || Boolean(window.desktop);
if (!isElectron) {
  document.documentElement.classList.add('preview');
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(<App />);
