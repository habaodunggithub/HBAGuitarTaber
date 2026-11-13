import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import { InkDefs } from './components/Sketch';
import Toaster from './components/Toaster';
import Home from './pages/Home';

const Workspace = lazy(() => import('./pages/Workspace'));

function NotFound() {
  return (
    <Shell>
      <main id="content" className="page narrow">
        <div className="message">
          <h1 className="display-sm">Page not found</h1>
          <p className="muted">The link may be out of date. Your tabs are still on the home page.</p>
          <Link to="/" className="btn">Go to home</Link>
        </div>
      </main>
    </Shell>
  );
}

export default function App() {
  return (
    <>
      <a className="skip-link" href="#content">Skip to main content</a>
      <Suspense fallback={<main id="content" className="page"><p className="muted" role="status">Loading…</p></main>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/t/:id" element={<Workspace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toaster />
      <InkDefs />
    </>
  );
}
