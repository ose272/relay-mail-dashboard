import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const accountPage=/\/sendar\/(signin|signup|welcome|about)\/?$/.test(window.location.pathname);
const root=createRoot(document.getElementById('root')!);
if(accountPage)void import('./AccountPages').then(({AccountPages})=>root.render(<AccountPages/>));
else root.render(<App/>);
