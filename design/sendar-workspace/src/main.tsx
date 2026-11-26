import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AccountPages} from './AccountPages';
import './index.css';

const accountPage=/\/sendar\/(signin|signup|welcome|about)\/?$/.test(window.location.pathname);
createRoot(document.getElementById('root')!).render(accountPage?<AccountPages/>:<App />);
