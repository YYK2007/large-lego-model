import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const App = React.lazy(() => import('./App').then(module => ({ default: module.App })));
const BuildGuide = React.lazy(() => import('./BuildGuide').then(module => ({ default: module.BuildGuide })));
const buildId = new URLSearchParams(location.search).get('build');
createRoot(document.getElementById('root')!).render(<React.StrictMode><React.Suspense fallback={<p className="app-opening">Opening your build…</p>}>
  {buildId ? <BuildGuide key={buildId} designId={buildId} /> : <App />}
</React.Suspense></React.StrictMode>);
