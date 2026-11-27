import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const accountPage=window.location.pathname==='/'||/\/sendar\/(signin|signup|welcome|about|privacy|terms|delete-account)\/?$/.test(window.location.pathname);
const root=createRoot(document.getElementById('root')!);
if(accountPage)void import('./AccountPages').then(({AccountPages})=>root.render(<AccountPages/>));
else root.render(<App/>);

if('serviceWorker' in navigator&&location.protocol==='https:')window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sendar/sw.js',{scope:'/sendar/'}).catch(()=>{});});
