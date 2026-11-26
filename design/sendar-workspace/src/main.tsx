import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const accountPage=/\/sendar\/(signin|signup|welcome|about)\/?$/.test(window.location.pathname);
const previewPage=/\/sendar\/design\/?$/.test(location.pathname)&&new URLSearchParams(location.search).get('frame')!=='1';
const root=createRoot(document.getElementById('root')!);
if(previewPage)void import('./DesignPreview').then(({DesignPreview})=>root.render(<DesignPreview/>));
else if(accountPage)void import('./AccountPages').then(({AccountPages})=>root.render(<AccountPages/>));
else root.render(<App/>);
