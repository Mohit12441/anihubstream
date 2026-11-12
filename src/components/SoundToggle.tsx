import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { soundFx } from '../lib/soundFx';

export function SoundToggle() {
  const [muted, setMuted] = useState(soundFx.isMuted());

  useEffect(() => {
    return soundFx.subscribe((newMuted) => setMuted(newMuted));
  }, []);

  return (
    <button
      type="button"
      className="icon-btn site-header__sound"
      onClick={() => soundFx.toggleMute()}
      aria-label={muted ? 'Enable UI sound effects' : 'Mute UI sound effects'}
      title={muted ? 'Enable sound effects' : 'Mute sound effects'}
    >
      {muted ? <VolumeX size={18} /> : <Volume2 size={18} className="text-accent" />}
    </button>
  );
}
