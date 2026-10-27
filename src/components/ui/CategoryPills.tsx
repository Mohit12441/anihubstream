import { useRef } from 'react';

export interface CategoryPillItem {
  id: string;
  label: string;
  count?: number;
  badge?: string;
  color?: string;
}

interface CategoryPillsProps {
  categories: CategoryPillItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
}

export function CategoryPills({
  categories,
  activeId,
  onSelect,
  className = '',
}: CategoryPillsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (!categories || categories.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className={`category-pills ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        overflowX: 'auto',
        padding: '6px 2px',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
      role="tablist"
      aria-label="Provider and category filters"
    >
      {categories.map((cat) => {
        const isActive = cat.id === activeId;
        const pillColor = cat.color || 'var(--brand, #6366f1)';

        return (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(cat.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '9999px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              border: isActive ? `1px solid ${pillColor}` : '1px solid rgba(255, 255, 255, 0.1)',
              background: isActive
                ? `linear-gradient(135deg, ${pillColor}28 0%, ${pillColor}15 100%)`
                : 'rgba(255, 255, 255, 0.04)',
              color: isActive ? '#fff' : '#94a3b8',
              boxShadow: isActive ? `0 0 16px ${pillColor}30` : 'none',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.color = '#e2e8f0';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                e.currentTarget.style.color = '#94a3b8';
              }
            }}
          >
            <span>{cat.label}</span>
            {cat.badge && (
              <span
                style={{
                  fontSize: '0.68rem',
                  padding: '1px 6px',
                  borderRadius: '9999px',
                  background: isActive ? `${pillColor}40` : 'rgba(255, 255, 255, 0.08)',
                  color: isActive ? '#fff' : '#cbd5e1',
                }}
              >
                {cat.badge}
              </span>
            )}
            {typeof cat.count === 'number' && cat.count > 0 && (
              <span
                style={{
                  fontSize: '0.72rem',
                  opacity: 0.8,
                  marginLeft: '2px',
                }}
              >
                ({cat.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
