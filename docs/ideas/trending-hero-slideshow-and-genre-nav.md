# Trending Anime Hero Slideshow & Direct Genre Navigation

## Problem Statement
How Might We transform the home page hero from a static image and redundant search bar into an immersive, high-converting Trending Anime Slideshow with 1-click playback and direct genre exploration?

---

## Recommended Direction: Netflix-Style Full-Bleed Slideshow + Direct Genre Navigation

1. **Full-Bleed Dynamic Hero Slideshow (`src/components/HeroSlideshow.tsx`)**:
   - Replaces the static `HERO.art` image and static copy in `HeroBanner.tsx`.
   - Uses `home.trending.slice(0, 8)` (already fetched by `/api/home` in memory).
   - Slides or cross-fades smoothly every 6 seconds (with pause on hover/focus).
   - Displays for each trending title:
     - Wide cinematic backdrop art (`anime.key || anime.poster`) with subtle dark gradients.
     - Trending rank badge (e.g. `🔥 #1 Trending This Week`).
     - Title, rating (`★ 8.9`), release year, format (`TV` / `Movie`), and genre tags.
     - Clean 2-line synopsis snippet.
     - Direct CTA buttons:
       - **"Watch Now"** (play icon, primary brand accent button) -> navigates directly to `/watch/:id/1`.
       - **"Details"** (info icon, ghost glass button) -> navigates to `/anime/:id`.
       - **"Add to List"** -> 1-click bookmarking.
     - Interactive slide indicators (dots with countdown progress bar or thumbnails) and prev/next arrows.

2. **Direct Genre Exploration Pills**:
   - Positioned cleanly directly beneath the hero slideshow or within a sleek translucent category bar.
   - Action, Adventure, Fantasy, Isekai, Romance, Slice of Life, Horror, Comedy, etc.
   - Clicking any genre button navigates directly to `/anime?genre=:id` (e.g. `/anime?genre=action`), opening the full catalog pre-filtered with infinite scroll.
   - Eliminates the confusing dead-end feeling where clicking a genre button didn't visibly change the hero banner.

3. **Search UI Streamlining**:
   - The large redundant search bar is removed from the middle of the Hero banner.
   - The global header navbar search button (and `/search` page) remains the single, prominent, keyboard-accessible (`/`) search entry point.

---

## Key Assumptions to Validate
- [ ] **Assumption 1**: Top 8 trending titles consistently have high-resolution horizontal key art (`key_art` or `key`).
  - *Validation*: Verify `artKeyUrl` fallback ensures no broken imagery if a title only has vertical poster art.
- [ ] **Assumption 2**: Autoplay slider does not cause layout shifts or memory leaks.
  - *Validation*: Use CSS opacity/transform transitions with `requestAnimationFrame` or `setInterval` cleared on unmount.
- [ ] **Assumption 3**: Direct genre navigation (`/anime?genre=:id`) feels immediate (< 100ms) with zero reload overhead.
  - *Validation*: React Router SPA navigation preserves state and instantly renders `AnimeCatalogue`.

---

## MVP Scope (Thin Vertical Slice)

### In-Scope (Phase 1):
1. **`HeroSlideshow.tsx` Component**:
   - Built with pure React + CSS transitions (no bulky external swiper libraries to keep bundle size minimal).
   - Autoplay with progress bar indicators, arrow controls, and keyboard navigation (`ArrowLeft` / `ArrowRight`).
   - 1-click "Watch Now" button linking directly to episode 1.
2. **Genre Buttons Redirection**:
   - Replace the local filter state with `<Link to={'/anime?genre=' + g.id}>` (or `navigate('/anime?genre=' + g.id)`).
3. **HeroBanner Cleanup**:
   - Remove static Demon Slayer hero artwork, static copy text, and hero search input.

### Not Doing (and Why):
- **External 3rd-Party Slider Dependencies (Swiper.js / Slick)**: Adding an extra 40KB+ bundle weight for a standard carousel is unnecessary; lightweight CSS transitions deliver 60fps performance with 0 extra KB.
- **Auto-playing Background Video Trailers**: Video trailers in the hero increase initial page load bandwidth and mobile data consumption drastically. Static high-res backdrops with CSS ken-burns/fade are faster and less intrusive.

---

## Open Questions & Verification
- Should the hero slideshow pause when the user scrolls down past the fold to conserve GPU/CPU cycles? (Recommended: Yes, via `IntersectionObserver`).
- Ready to proceed with implementing `HeroSlideshow.tsx` and updating `src/pages/Home.tsx`?
