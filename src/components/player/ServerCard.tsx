interface ServerCardProps {
  server: any;
  isActive: boolean;
  onSelect: (server: any) => void;
}

export function ServerCard({ server, isActive, onSelect }: ServerCardProps) {
  const isUnavailable = server.status === 'unavailable';

  return (
    <div
      onClick={!isUnavailable && !isActive ? () => onSelect(server) : undefined}
      className={`
        relative flex flex-col gap-2 p-4 rounded-xl border transition-all text-left
        ${isActive ? 'border-white/40 bg-white/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}
        ${isUnavailable ? 'opacity-50 grayscale cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {/* Header */}
      <div className="flex justify-between items-center gap-2">
        <span className="font-semibold text-white text-sm truncate">{server.name}</span>
        {isUnavailable ? (
          <span className="text-xs text-amber-400 font-medium whitespace-nowrap">⚠️ Unavailable</span>
        ) : isActive ? (
          <span className="text-xs text-green-400 font-medium whitespace-nowrap">▶️ Active</span>
        ) : (
          <span className="text-xs text-blue-400 font-medium whitespace-nowrap">⏳ Ready</span>
        )}
      </div>

      {/* Meta */}
      <div className="text-xs text-white/60 flex gap-3 flex-wrap">
        {server.quality && <span>{server.quality}</span>}
        <span>🎵 {server.audioTracks?.length || (server.audio === 'dub' ? 1 : 1)} audio</span>
        {server.subtitles?.length > 0 && <span>📝 {server.subtitles.length} subs</span>}
      </div>

      {/* Unavailable Reason */}
      {isUnavailable && server.unavailableReason && (
        <div className="text-xs text-amber-400/90 mt-1">
          ⛔ {server.unavailableReason}
        </div>
      )}

      {/* Action Button */}
      {!isUnavailable && !isActive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(server);
          }}
          className="mt-2 w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors text-center"
        >
          Play this server
        </button>
      )}
    </div>
  );
}
