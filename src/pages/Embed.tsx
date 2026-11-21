import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ExternalLink, Play, Film } from 'lucide-react';
import { AdvancedPlayer } from '../components/player/AdvancedPlayer';
import type { PlayServer } from '../components/player/PlayerInput';
import type { Episode } from '../data/model';
import { getPlay } from '../data/api';
import { useAnimeDetail } from '../state/catalogue';
import { usePlayerPreferences } from '../lib/usePlayerPrefs';
import '../styles/player.css';

export function Embed() {
  const { id, ep } = useParams<{ id: string; ep?: string }>();
  const epNum = Math.max(1, parseInt(ep || '1', 10) || 1);

  const { anime, status } = useAnimeDetail(id || '');
  const [servers, setServers] = useState<PlayServer[]>([]);
  const [activeServer, setActiveServer] = useState<PlayServer | null>(null);
  const [loadingStream, setLoadingStream] = useState(true);
  const [theatre, setTheatre] = useState(false);

  const { prefs, patch, patchSubs, restoreSubs, restoreAppearance } = usePlayerPreferences();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    setLoadingStream(true);
    getPlay({ id, ep: epNum, audio: 'sub' })
      .then((res) => {
        if (cancelled) return;
        if (res && res.servers && res.servers.length > 0) {
          setServers(res.servers);
          const best = res.servers.find((s) => s.status === 'ready' && s.streamUrl) || res.servers[0];
          setActiveServer(best || null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingStream(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, epNum]);

  const animeTitle = anime?.title || id || 'Anime';
  const watchUrl = `/watch/${id}/${epNum}`;
  const isLoading = status === 'loading' || loadingStream;

  const currentEpisode: Episode = useMemo(() => {
    const found = anime?.episodes?.find((e) => e.n === epNum);
    if (found) return found;
    return {
      n: epNum,
      title: `Episode ${epNum}`,
      thumb: anime?.poster || '',
      runtime: '24m',
      synopsis: '',
      markers: [],
    };
  }, [anime, epNum]);

  const nextEpisode: Episode | null = useMemo(() => {
    return anime?.episodes?.find((e) => e.n === epNum + 1) || null;
  }, [anime, epNum]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 9999,
      }}
    >
      {/* Embedded Player */}
      <div style={{ position: 'relative', width: '100%', height: '100%', flex: 1 }}>
        {anime && activeServer ? (
          <AdvancedPlayer
            anime={anime}
            animeId={anime.id}
            episode={currentEpisode}
            next={nextEpisode}
            hasPrev={epNum > 1}
            hasNext={Boolean(nextEpisode)}
            onPrev={() => {}}
            onNext={() => {}}
            theatre={theatre}
            onTheatre={setTheatre}
            prefs={prefs}
            patch={patch}
            patchSubs={patchSubs}
            restoreSubs={restoreSubs}
            restoreAppearance={restoreAppearance}
            resumeAt={0}
            onProgress={() => {}}
            servers={servers}
            serverId={activeServer.id}
            onSelectServer={setActiveServer}
            initialServer={activeServer}
            initialPartyRoom={null}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#fff',
              gap: 12,
              padding: 20,
              textAlign: 'center',
            }}
          >
            {isLoading ? (
              <>
                <div className="pl__spin" style={{ width: 36, height: 36 }} />
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                  Loading {animeTitle} Episode {epNum}...
                </p>
              </>
            ) : (
              <>
                <Film size={36} color="#818cf8" />
                <p style={{ fontSize: 14, fontWeight: 600 }}>{animeTitle} — Episode {epNum}</p>
                <a
                  href={watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    backgroundColor: '#6366f1',
                    color: '#fff',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  <Play size={15} fill="currentColor" />
                  <span>Watch on AniHubStream</span>
                </a>
              </>
            )}
          </div>
        )}

        {/* Backlink Branding Watermark */}
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Watch Full HD on AniHubStream with Watch Party"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 60,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            backgroundColor: 'rgba(10, 12, 18, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 6,
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            textDecoration: 'none',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#6366f1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(10, 12, 18, 0.85)';
          }}
        >
          <span>AniHubStream</span>
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
