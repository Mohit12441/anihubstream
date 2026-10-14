import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { Home } from './pages/Home';
import { Watch } from './pages/Watch';
import { AnimeCatalogue } from './pages/AnimeCatalogue';
import { Genres } from './pages/Genres';
import { MyList } from './pages/MyList';
import { Schedule } from './pages/Schedule';
import { Discover } from './pages/Discover';
import { NotFound } from './pages/NotFound';

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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/watch/:id" element={<Watch />} />
          <Route path="/anime" element={<AnimeCatalogue />} />
          <Route path="/genres" element={<Genres />} />
          <Route path="/my-list" element={<MyList />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
