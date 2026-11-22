import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import { InkDefs } from './components/Sketch';
import Toaster from './components/Toaster';
import { useT } from './i18n';
import Home from './pages/Home';

const Workspace = lazy(() => import('./pages/Workspace'));

function NotFound() {
  const t = useT();
  return (
    <Shell>
      <main id="content" className="page narrow">
        <div className="message">
          <h1 className="display-sm">{t.app.notFound}</h1>
          <p className="muted">{t.app.notFoundBody}</p>
          <Link to="/" className="btn">{t.app.goHome}</Link>
        </div>
      </main>
    </Shell>
  );
}

export default function App() {
  const t = useT();
  return (
    <>
      <a className="skip-link" href="#content">{t.app.skip}</a>
      <Suspense fallback={<main id="content" className="page"><p className="muted" role="status">{t.app.loading}</p></main>}>
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
