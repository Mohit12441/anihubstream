import { useState, useEffect } from 'react';

const STORAGE_KEY = 'anihub_saved_articles';
const EVENT_NAME = 'anihub_saved_articles_changed';

export function getSavedArticleSlugs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isArticleSaved(slug: string): boolean {
  if (!slug) return false;
  return getSavedArticleSlugs().includes(slug);
}

export function toggleSavedArticle(slug: string): boolean {
  if (!slug || typeof window === 'undefined') return false;
  try {
    const current = getSavedArticleSlugs();
    let next: string[];
    let added = false;
    if (current.includes(slug)) {
      next = current.filter((s) => s !== slug);
      added = false;
    } else {
      next = [slug, ...current];
      added = true;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { slug, added, next } }));
    return added;
  } catch {
    return false;
  }
}

export function useSavedArticles() {
  const [savedSlugs, setSavedSlugs] = useState<string[]>(() => getSavedArticleSlugs());

  useEffect(() => {
    const handleUpdate = () => {
      setSavedSlugs(getSavedArticleSlugs());
    };

    window.addEventListener(EVENT_NAME, handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener(EVENT_NAME, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  return {
    savedSlugs,
    isSaved: (slug: string) => savedSlugs.includes(slug),
    toggleSave: (slug: string) => toggleSavedArticle(slug),
  };
}
