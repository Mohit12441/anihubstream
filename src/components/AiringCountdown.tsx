import { useEffect, useState } from 'react';
import { Bell, BellOff, Clock, Sparkles, Timer } from 'lucide-react';
import { computeAiringCountdown, type AiringCountdownResult, type ScheduleInfo } from '../lib/airingCountdown';
import { isNotificationSupported, isSubscribed, toggleSubscription } from '../lib/notifications';

interface Props {
  anime: {
    id: string;
    title: string;
    status?: string;
    poster?: string;
    schedule?: ScheduleInfo | null;
    episodeTotal?: number | null;
    episodeCount?: number | null;
  };
  variant?: 'badge' | 'banner' | 'compact';
  showRemindMe?: boolean;
  onRemindChange?: (subscribed: boolean) => void;
}

export function AiringCountdown({
  anime,
  variant = 'badge',
  showRemindMe = true,
  onRemindChange,
}: Props) {
  const [countdown, setCountdown] = useState<AiringCountdownResult | null>(() =>
    computeAiringCountdown(anime.schedule, anime.episodeTotal, anime.episodeCount)
  );
  const [subscribed, setSubscribed] = useState(() => isSubscribed(anime.id));
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    setSubscribed(isSubscribed(anime.id));
  }, [anime.id]);

  useEffect(() => {
    if (!anime.schedule?.day || !anime.schedule?.time) {
      setCountdown(null);
      return;
    }

    const update = () => {
      const res = computeAiringCountdown(anime.schedule, anime.episodeTotal, anime.episodeCount);
      setCountdown(res);
    };

    update();

    // High precision (1s) when airing soon (<1h), lower frequency (30s) otherwise
    const intervalMs = (countdown?.totalSeconds ?? 0) <= 3600 ? 1000 : 30000;
    const timer = setInterval(update, intervalMs);

    return () => clearInterval(timer);
  }, [anime.schedule, anime.episodeTotal, anime.episodeCount, countdown?.totalSeconds]);

  if (!countdown) return null;

  const handleToggleRemind = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsToggling(true);
    try {
      const nextState = await toggleSubscription({
        id: anime.id,
        title: anime.title,
        poster: anime.poster,
        schedule: anime.schedule,
      });
      setSubscribed(nextState);
      onRemindChange?.(nextState);
    } finally {
      setIsToggling(false);
    }
  };

  const nextEpLabel = countdown.nextEpisode ? `Ep ${countdown.nextEpisode}` : 'Next Ep';

  // Variant: Compact (used inside small card overlays)
  if (variant === 'compact') {
    return (
      <span
        className={`airing-pill ${countdown.isAiringSoon ? 'airing-pill--urgent' : ''}`}
        title={`Airing in ${countdown.formatted}`}
      >
        <Timer size={11} className="airing-pill__icon" />
        <span>{nextEpLabel} in {countdown.shortLabel}</span>
      </span>
    );
  }

  // Variant: Badge (used in card footers or lists)
  if (variant === 'badge') {
    return (
      <span
        className={`airing-badge ${countdown.isAiringSoon ? 'airing-badge--pulse' : ''}`}
        title={`Broadcast target: ${countdown.targetDate.toLocaleString()}`}
      >
        <Clock size={12} />
        <span>{nextEpLabel}: {countdown.shortLabel}</span>
      </span>
    );
  }

  // Variant: Banner (used prominently on AnimeDetail page)
  return (
    <div className={`airing-banner ${countdown.isAiringSoon ? 'airing-banner--urgent' : ''}`}>
      <div className="airing-banner__content">
        <div className="airing-banner__icon">
          {countdown.isAiringSoon ? (
            <Sparkles size={20} className="pulse-spin" />
          ) : (
            <Timer size={20} />
          )}
        </div>
        <div className="airing-banner__text">
          <div className="airing-banner__title">
            <b>{nextEpLabel} Broadcast</b>
            {countdown.isAiringToday && (
              <span className="airing-banner__today">TODAY</span>
            )}
          </div>
          <div className="airing-banner__countdown">
            Airing in <b>{countdown.formatted}</b>
          </div>
        </div>
      </div>

      {showRemindMe && isNotificationSupported() && (
        <button
          type="button"
          onClick={handleToggleRemind}
          disabled={isToggling}
          className={`airing-remind-btn ${subscribed ? 'airing-remind-btn--active' : ''}`}
          title={subscribed ? 'Reminders active for this anime' : 'Get notified when this episode airs'}
        >
          {subscribed ? <BellOff size={15} /> : <Bell size={15} />}
          <span>{subscribed ? 'Subscribed' : 'Remind Me'}</span>
        </button>
      )}
    </div>
  );
}
