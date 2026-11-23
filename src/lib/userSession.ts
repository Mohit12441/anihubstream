/**
 * src/lib/userSession.ts
 *
 * Lightweight, privacy-first anonymous persona for requests and comments.
 * Stored in localStorage so users keep their chosen nickname, avatar, and voting history
 * without requiring email/password accounts.
 */

export interface UserPersona {
  uid: string;
  name: string;
  avatar: string;
}

export interface AnimeAvatar {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export const AVATAR_PRESETS: AnimeAvatar[] = [
  { id: 'luffy', name: 'Luffy', color: '#ff4757', icon: '🍖' },
  { id: 'zoro', name: 'Zoro', color: '#2ed573', icon: '⚔️' },
  { id: 'gojo', name: 'Gojo', color: '#1e90ff', icon: '🤞' },
  { id: 'nezuko', name: 'Nezuko', color: '#ff6b81', icon: '🎋' },
  { id: 'anya', name: 'Anya', color: '#ffa502', icon: '🥜' },
  { id: 'naruto', name: 'Naruto', color: '#ff7f50', icon: '🍥' },
  { id: 'levi', name: 'Levi', color: '#747d8c', icon: '🗡️' },
  { id: 'fern', name: 'Fern', color: '#9b59b6', icon: '🪄' },
];

const STORAGE_KEY = 'anihub_user_persona';

export function getUserPersona(): UserPersona {
  if (typeof window === 'undefined') {
    return { uid: 'guest', name: 'Otaku', avatar: 'luffy' };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.uid && parsed.name && parsed.avatar) return parsed;
    }
  } catch {}

  // Generate new anonymous UID
  const newPersona: UserPersona = {
    uid: `u_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
    name: `Otaku_${Math.floor(100 + Math.random() * 900)}`,
    avatar: AVATAR_PRESETS[Math.floor(Math.random() * AVATAR_PRESETS.length)].id,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newPersona));
  } catch {}

  return newPersona;
}

export function saveUserPersona(updates: Partial<Omit<UserPersona, 'uid'>>): UserPersona {
  const current = getUserPersona();
  const next: UserPersona = {
    ...current,
    name: updates.name ? updates.name.trim().slice(0, 30) : current.name,
    avatar: updates.avatar || current.avatar,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}

  return next;
}
