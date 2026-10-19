import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  type?: string;
  canonicalUrl?: string;
  jsonLd?: Record<string, unknown> | null;
  noindex?: boolean;
}

export function useSEO({ title, description, image, type = 'website', canonicalUrl, jsonLd, noindex = false }: SEOProps = {}) {
  const { pathname } = useLocation();

  useEffect(() => {
    const origin = typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'https://anihubstream.com';
    const fullUrl = canonicalUrl || `${origin}${pathname}`;

    if (title) {
      document.title = title;
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute('content', title);
      const twTitle = document.querySelector('meta[name="twitter:title"]');
      if (twTitle) twTitle.setAttribute('content', title);
    }

    if (description) {
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) metaDesc.setAttribute('content', description);
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute('content', description);
      const twDesc = document.querySelector('meta[name="twitter:description"]');
      if (twDesc) twDesc.setAttribute('content', description);
    }

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', fullUrl);

    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute('content', fullUrl);

    if (image) {
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) ogImg.setAttribute('content', image);
      const twImg = document.querySelector('meta[name="twitter:image"]');
      if (twImg) twImg.setAttribute('content', image);
    }

    const ogType = document.querySelector('meta[property="og:type"]');
    if (ogType) ogType.setAttribute('content', type);

    let twCard = document.querySelector('meta[name="twitter:card"]');
    if (!twCard) {
      twCard = document.createElement('meta');
      twCard.setAttribute('name', 'twitter:card');
      document.head.appendChild(twCard);
    }
    twCard.setAttribute('content', 'summary_large_image');

    let metaRobots = document.querySelector('meta[name="robots"]');
    if (noindex) {
      if (!metaRobots) {
        metaRobots = document.createElement('meta');
        metaRobots.setAttribute('name', 'robots');
        document.head.appendChild(metaRobots);
      }
      metaRobots.setAttribute('content', 'noindex, follow');
    } else if (metaRobots) {
      metaRobots.setAttribute('content', 'index, follow');
    }

    let script = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      if (!script) {
        script = document.createElement('script');
        script.setAttribute('type', 'application/ld+json');
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(jsonLd);
    } else if (script) {
      script.remove();
    }
  }, [title, description, image, type, canonicalUrl, jsonLd, noindex, pathname]);
}
