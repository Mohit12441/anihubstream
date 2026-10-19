import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { Home } from './pages/Home';

const Watch = lazy(() => import('./pages/Watch').then((m) => ({ default: m.Watch })));
const AnimeCatalogue = lazy(() => import('./pages/AnimeCatalogue').then((m) => ({ default: m.AnimeCatalogue })));
const Genres = lazy(() => import('./pages/Genres').then((m) => ({ default: m.Genres })));
const MyList = lazy(() => import('./pages/MyList').then((m) => ({ default: m.MyList })));
const Schedule = lazy(() => import('./pages/Schedule').then((m) => ({ default: m.Schedule })));
const Discover = lazy(() => import('./pages/Discover').then((m) => ({ default: m.Discover })));
const About = lazy(() => import('./pages/About').then((m) => ({ default: m.About })));
const Dmca = lazy(() => import('./pages/Dmca').then((m) => ({ default: m.Dmca })));
const Privacy = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./pages/Terms').then((m) => ({ default: m.Terms })));
const Contact = lazy(() => import('./pages/Contact').then((m) => ({ default: m.Contact })));
const Search = lazy(() => import('./pages/Search').then((m) => ({ default: m.Search })));
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

export function App() {
  const { pathname } = useLocation();
  const bare = pathname === '/discover';

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <ScrollToTop />
      {!bare && <Header />}
      <main id="main">
        <Suspense fallback={<div className="page-loading" style={{ minHeight: '60vh' }} />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/watch/:id" element={<Watch />} />
            <Route path="/watch/:id/:ep" element={<Watch />} />
            <Route path="/anime" element={<AnimeCatalogue />} />
            <Route path="/genres" element={<Genres />} />
            <Route path="/my-list" element={<MyList />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/search" element={<Search />} />
            <Route path="/about" element={<About />} />
            <Route path="/dmca" element={<Dmca />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
