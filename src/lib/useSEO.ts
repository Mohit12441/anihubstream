import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  imageAlt?: string;
  type?: string;
  publishedTime?: string;
  author?: string;
  canonicalUrl?: string;
  jsonLd?: Record<string, unknown> | null;
  noindex?: boolean;
}

export function useSEO({
  title,
  description,
  image,
  imageAlt,
  type = 'website',
  publishedTime,
  author,
  canonicalUrl,
  jsonLd,
  noindex = false,
}: SEOProps = {}) {
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

      // Remove fixed 1792x1024 dims if article image
      const ogWidth = document.querySelector('meta[property="og:image:width"]');
      const ogHeight = document.querySelector('meta[property="og:image:height"]');
      if (type === 'article') {
        if (ogWidth) ogWidth.remove();
        if (ogHeight) ogHeight.remove();
      }
    }

    if (imageAlt || title) {
      const altText = imageAlt || title || 'AniHubStream';
      const ogAlt = document.querySelector('meta[property="og:image:alt"]');
      if (ogAlt) ogAlt.setAttribute('content', altText);
      const twAlt = document.querySelector('meta[name="twitter:image:alt"]');
      if (twAlt) twAlt.setAttribute('content', altText);
    }

    const ogType = document.querySelector('meta[property="og:type"]');
    if (ogType) ogType.setAttribute('content', type);

    if (type === 'article') {
      if (publishedTime) {
        let pubMeta = document.querySelector('meta[property="article:published_time"]');
        if (!pubMeta) {
          pubMeta = document.createElement('meta');
          pubMeta.setAttribute('property', 'article:published_time');
          document.head.appendChild(pubMeta);
        }
        pubMeta.setAttribute('content', publishedTime);
      }
      if (author) {
        let authMeta = document.querySelector('meta[property="article:author"]');
        if (!authMeta) {
          authMeta = document.createElement('meta');
          authMeta.setAttribute('property', 'article:author');
          document.head.appendChild(authMeta);
        }
        authMeta.setAttribute('content', author);
      }
    } else {
      const pubMeta = document.querySelector('meta[property="article:published_time"]');
      if (pubMeta) pubMeta.remove();
      const authMeta = document.querySelector('meta[property="article:author"]');
      if (authMeta) authMeta.remove();
    }

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

    // Target dedicated page-schema element so website-schema is never overwritten
    let pageScript = document.getElementById('page-schema') as HTMLScriptElement | null;
    if (jsonLd) {
      if (!pageScript) {
        pageScript = document.createElement('script');
        pageScript.setAttribute('type', 'application/ld+json');
        pageScript.id = 'page-schema';
        document.head.appendChild(pageScript);
      }
      pageScript.textContent = JSON.stringify(jsonLd);
    } else if (pageScript) {
      pageScript.remove();
    }
  }, [title, description, image, imageAlt, type, publishedTime, author, canonicalUrl, jsonLd, noindex, pathname]);
}
