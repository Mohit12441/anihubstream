/**
 * AniHubStream Embeddable Widget v1.0
 * Allows any external anime blog, wiki, or fansite to embed live trending anime & release countdowns.
 * Every embedded widget naturally embeds a high-authority brand backlink to https://anihubstream.com.
 *
 * Usage on external sites:
 *   <div id="anihub-widget" data-theme="dark" data-limit="5"></div>
 *   <script src="https://anihubstream.com/widgets/anihub-widget.js" async></script>
 */
(function () {
  'use strict';

  var CONTAINER_ID = 'anihub-widget';
  var BASE_URL = 'https://anihubstream.com';

  function initWidget() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    var theme = container.getAttribute('data-theme') || 'dark';
    var limit = parseInt(container.getAttribute('data-limit') || '5', 10);
    var isDark = theme !== 'light';

    var bgColor = isDark ? '#0d1117' : '#ffffff';
    var textColor = isDark ? '#e6edf3' : '#1f2328';
    var subColor = isDark ? '#8b949e' : '#656d76';
    var cardBg = isDark ? '#161b22' : '#f6f8fa';
    var borderColor = isDark ? '#30363d' : '#d0d7de';
    var accentColor = '#6366f1';

    // Inject styles
    var styleId = 'anihub-widget-styles';
    if (!document.getElementById(styleId)) {
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .anihub-w-box {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: ${bgColor};
          color: ${textColor};
          border: 1px solid ${borderColor};
          border-radius: 12px;
          padding: 16px;
          max-width: 400px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        }
        .anihub-w-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid ${borderColor};
        }
        .anihub-w-title {
          font-size: 15px;
          font-weight: 700;
          color: ${textColor};
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .anihub-w-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #22c55e;
          display: inline-block;
          animation: anihubPulse 2s infinite;
        }
        @keyframes anihubPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.9); }
        }
        .anihub-w-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .anihub-w-item {
          display: flex;
          align-items: center;
          gap: 10px;
          background: ${cardBg};
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid ${borderColor};
          text-decoration: none;
          color: inherit;
          transition: transform 0.15s ease, border-color 0.15s ease;
        }
        .anihub-w-item:hover {
          transform: translateY(-1px);
          border-color: ${accentColor};
        }
        .anihub-w-thumb {
          width: 42px;
          height: 56px;
          border-radius: 4px;
          object-fit: cover;
          background: #21262d;
          flex-shrink: 0;
        }
        .anihub-w-info {
          overflow: hidden;
          flex: 1;
        }
        .anihub-w-item-title {
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin: 0 0 4px 0;
        }
        .anihub-w-item-sub {
          font-size: 11px;
          color: ${subColor};
          margin: 0;
        }
        .anihub-w-footer {
          margin-top: 12px;
          padding-top: 8px;
          border-top: 1px solid ${borderColor};
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: ${subColor};
        }
        .anihub-w-link {
          color: ${accentColor};
          text-decoration: none;
          font-weight: 600;
        }
        .anihub-w-link:hover {
          text-decoration: underline;
        }
      `;
      document.head.appendChild(style);
    }

    container.innerHTML = `
      <div class="anihub-w-box">
        <div class="anihub-w-header">
          <div class="anihub-w-title">
            <span class="anihub-w-dot"></span> Trending Anime Airing
          </div>
          <span style="font-size: 11px; color: ${subColor};">HD Streams</span>
        </div>
        <div id="anihub-w-body" style="min-height: 80px; display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 12px; color: ${subColor};">Loading latest anime...</span>
        </div>
        <div class="anihub-w-footer">
          <span>Updated Hourly</span>
          <span>Powered by <a class="anihub-w-link" href="${BASE_URL}" target="_blank" rel="noopener">AniHubStream</a></span>
        </div>
      </div>
    `;

    // Fetch editorial or catalog data
    fetch(BASE_URL + '/editorial.json')
      .then(function (res) { return res.json(); })
      .then(function (articles) {
        var body = document.getElementById('anihub-w-body');
        if (!body) return;

        var sampleList = [];
        if (Array.isArray(articles) && articles.length > 0) {
          articles.slice(0, limit).forEach(function (art) {
            sampleList.push({
              title: art.title ? art.title.split(':')[0] : 'Trending Anime',
              slug: (art.relatedAnimeSlugs && art.relatedAnimeSlugs[0]) || 'explore',
              img: art.coverImage || '',
              badge: art.badge || 'Popular'
            });
          });
        }

        if (sampleList.length === 0) {
          body.innerHTML = '<span style="font-size: 12px; color: ' + subColor + ';">Visit AniHubStream for latest anime</span>';
          return;
        }

        var listHtml = '<ul class="anihub-w-list">';
        sampleList.forEach(function (item) {
          var targetUrl = BASE_URL + '/anime/' + encodeURIComponent(item.slug);
          listHtml += `
            <li>
              <a class="anihub-w-item" href="${targetUrl}" target="_blank" rel="noopener">
                ${item.img ? `<img class="anihub-w-thumb" src="${item.img}" alt="${item.title}" loading="lazy" />` : ''}
                <div class="anihub-w-info">
                  <p class="anihub-w-item-title">${item.title}</p>
                  <p class="anihub-w-item-sub">${item.badge} · Watch in HD</p>
                </div>
              </a>
            </li>
          `;
        });
        listHtml += '</ul>';
        body.innerHTML = listHtml;
      })
      .catch(function () {
        var body = document.getElementById('anihub-w-body');
        if (body) {
          body.innerHTML = `
            <div style="text-align: center; padding: 12px 0;">
              <p style="margin: 0 0 6px 0; font-size: 13px;">Stream your favorite anime in HD free.</p>
              <a class="anihub-w-link" href="${BASE_URL}" target="_blank" rel="noopener">Browse All Anime on AniHubStream &rarr;</a>
            </div>
          `;
        }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }
})();
