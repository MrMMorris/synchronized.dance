/* Shared renderer for every artist page.
   The page itself is a shell — head tags for link previews, plus <div id="artist">.
   Everything visible below is built from that artist's entry in /artists.json,
   so adding a link is a JSON edit, not an HTML edit. */
(function () {
  'use strict';

  // Brand marks, drawn inline so the page stays self-contained.
  const ICONS = {
    soundcloud: '<svg viewBox="0 0 24 24"><path d="M1.2 14.3c-.1 0-.2.1-.2.2l-.2 1.5.2 1.4c0 .1.1.2.2.2s.2-.1.2-.2l.2-1.4-.2-1.5c0-.1-.1-.2-.2-.2zm1.4-.8c-.1 0-.2.1-.2.2L2.2 16l.2 2.2c0 .1.1.2.2.2s.2-.1.2-.2l.2-2.2-.2-2.3c0-.1-.1-.2-.2-.2zm1.5-.6c-.1 0-.3.1-.3.3l-.2 2.8.2 2.2c0 .1.1.2.3.2.1 0 .2-.1.3-.2l.2-2.2-.2-2.8c0-.2-.1-.3-.3-.3zm1.6-.3c-.2 0-.3.1-.3.3l-.2 3.1.2 2.1c0 .2.1.3.3.3s.3-.1.3-.3l.2-2.1-.2-3.1c0-.2-.1-.3-.3-.3zm1.7-.4c-.2 0-.3.2-.3.3l-.2 3.5.2 2.1c0 .2.2.3.3.3.2 0 .3-.2.3-.3l.2-2.1-.2-3.5c0-.2-.2-.3-.3-.3zm1.7-.9c-.2 0-.4.2-.4.4l-.2 4.4.2 2c0 .2.2.4.4.4s.4-.2.4-.4l.2-2-.2-4.4c0-.2-.2-.4-.4-.4zm1.8-1.7c-.2 0-.4.2-.4.4l-.2 6.1.2 2c0 .2.2.4.4.4s.4-.2.4-.4l.2-2-.2-6.1c0-.2-.2-.4-.4-.4zm1.8-.8c-.3 0-.5.2-.5.5l-.1 6.8.1 1.9c0 .3.2.5.5.5s.5-.2.5-.5l.2-1.9-.2-6.8c0-.3-.2-.5-.5-.5zm2.6 9.7h5.9c1.8 0 3.3-1.5 3.3-3.3s-1.5-3.3-3.3-3.3c-.5 0-.9.1-1.3.3C19.4 8.9 16.7 6.4 13.5 6.4c-.8 0-1.5.2-2.2.5-.2.1-.3.2-.3.5v10.7c0 .2.2.4.4.4z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 2.2c-3.1 0-3.5 0-4.7.1-1.1 0-1.7.2-2.1.4-.5.2-.9.4-1.3.8-.4.4-.6.8-.8 1.3-.2.4-.3 1-.4 2.1-.1 1.2-.1 1.6-.1 4.7s0 3.5.1 4.7c0 1.1.2 1.7.4 2.1.2.5.4.9.8 1.3.4.4.8.6 1.3.8.4.2 1 .3 2.1.4 1.2.1 1.6.1 4.7.1s3.5 0 4.7-.1c1.1 0 1.7-.2 2.1-.4.5-.2.9-.4 1.3-.8.4-.4.6-.8.8-1.3.2-.4.3-1 .4-2.1.1-1.2.1-1.6.1-4.7s0-3.5-.1-4.7c0-1.1-.2-1.7-.4-2.1-.2-.5-.4-.9-.8-1.3-.4-.4-.8-.6-1.3-.8-.4-.2-1-.3-2.1-.4-1.2-.1-1.6-.1-4.7-.1zm0 3.7a5.9 5.9 0 1 1 0 11.8 5.9 5.9 0 0 1 0-11.8zm0 2.1a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zm6.1-2.4a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/></svg>',
    spotify: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.3.9zm1.2-2.7a.8.8 0 0 1-1 .3c-2.7-1.7-6.9-2.2-10.1-1.2a.8.8 0 1 1-.4-1.5c3.7-1.1 8.3-.6 11.4 1.4.3.2.4.7.1 1zm.1-2.8C14.7 8.9 9.4 8.7 6.3 9.6a.9.9 0 1 1-.5-1.8c3.6-1.1 9.4-.9 13.1 1.3a.9.9 0 1 1-1 1.6z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24"><path d="M23 12s0-3.3-.4-4.8c-.2-.9-.9-1.5-1.7-1.7C19.3 5 12 5 12 5s-7.3 0-8.9.5c-.8.2-1.5.8-1.7 1.7C1 8.7 1 12 1 12s0 3.3.4 4.8c.2.9.9 1.5 1.7 1.7 1.6.5 8.9.5 8.9.5s7.3 0 8.9-.5c.8-.2 1.5-.8 1.7-1.7.4-1.5.4-4.8.4-4.8zM9.8 15.3V8.7l6 3.3-6 3.3z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24"><path d="M16.6 2h-3.1v13.4a2.6 2.6 0 1 1-2-2.5V9.7a5.9 5.9 0 1 0 5.1 5.8V9a7.2 7.2 0 0 0 4.2 1.3V7.2a4.1 4.1 0 0 1-4.2-4.1V2z"/></svg>',
    bandcamp: '<svg viewBox="0 0 24 24"><path d="M0 18.2h15.6L24 5.8H8.4L0 18.2z"/></svg>',
    mixcloud: '<svg viewBox="0 0 24 24"><path d="M19.3 9.2a7 7 0 0 0-13-1.9A5.2 5.2 0 0 0 5.2 17.6h14a4.2 4.2 0 0 0 .1-8.4zm0 6.4h-14a3.2 3.2 0 0 1 0-6.4h.4l.7.1.2-.8a5 5 0 0 1 9.6.9l.2.9.9-.1h2a2.2 2.2 0 0 1 0 5.4z"/></svg>',
    ticket: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.2a2.8 2.8 0 0 0 0 5.6V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.2a2.8 2.8 0 0 0 0-5.6V7zm11 .5v2h1.5v-2H14zm0 3.5v2h1.5v-2H14zm0 3.5v2h1.5v-2H14z"/></svg>',
    email: '<svg viewBox="0 0 24 24"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 7.1L4.3 7h15.4L12 12.1zM4 8.6V17h16V8.6l-8 5.3-8-5.3z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10.6 13.4a1 1 0 0 0 1.4 0l4.9-4.9a2.5 2.5 0 1 1 3.6 3.6l-2.1 2.1a1 1 0 0 0 1.4 1.4l2.1-2.1a4.5 4.5 0 1 0-6.4-6.4l-4.9 4.9a1 1 0 0 0 0 1.4zm2.8-2.8a1 1 0 0 0-1.4 0l-4.9 4.9a2.5 2.5 0 1 1-3.6-3.6l2.1-2.1a1 1 0 1 0-1.4-1.4l-2.1 2.1a4.5 4.5 0 1 0 6.4 6.4l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>',
  };

  const el = document.getElementById('artist');

  // Slug comes from the folder the page is served out of: /artists/<slug>/.
  function currentSlug() {
    const override = document.body.dataset.artist;
    if (override) return override;
    const parts = window.location.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('artists');
    return i !== -1 && parts[i + 1] ? parts[i + 1].replace(/\.html$/, '') : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function icon(name) {
    return ICONS[name] || ICONS.link;
  }

  // Runs after esc(), so it's only ever matching already-escaped text.
  function linkifyEmails(s) {
    return s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, m => `<a href="mailto:${m}">${m}</a>`);
  }

  // SoundCloud's widget takes the plain permalink, so no track ID lookup needed.
  function soundcloudSrc(embed, accent) {
    const params = new URLSearchParams({
      url: embed.url,
      color: (accent || '#ffffff').replace('#', '#'),
      auto_play: 'false',
      hide_related: 'true',
      show_comments: 'false',
      show_user: 'true',
      show_reposts: 'false',
      show_teaser: 'false',
      visual: embed.visual === false ? 'false' : 'true',
    });
    return 'https://w.soundcloud.com/player/?' + params.toString();
  }

  function embedHtml(embed, accent) {
    if (!embed || !embed.url) return '';
    // "visual" is SoundCloud's big-artwork player; false gives the compact bar.
    // An explicit height in the JSON always wins (20 = SoundCloud's mini strip).
    let src, height;
    if (embed.type === 'soundcloud') {
      src = soundcloudSrc(embed, accent);
      height = embed.height || (embed.visual === false ? 166 : 340);
    } else {
      // Any other provider: the JSON supplies a ready-made iframe src.
      src = embed.url;
      height = embed.height || 340;
    }
    return `<div class="embed-wrap"><iframe height="${height}" scrolling="no" allow="autoplay; encrypted-media"
      loading="lazy" title="${esc(embed.title || 'Featured mix')}" src="${esc(src)}"></iframe></div>`;
  }

  function linkHtml(link) {
    const cls = 'link-btn' + (link.icon === 'ticket' ? ' link-btn--event' : '');
    const note = link.note ? `<span class="link-note">${esc(link.note)}</span>` : '';
    return `<a class="${cls}" href="${esc(link.url)}" target="_blank" rel="noopener"
      onclick="trackArtistLink('${esc(link.label)}')">${icon(link.icon)}<span class="link-label">${esc(link.label)}${note}</span></a>`;
  }

  // Optional: pull this artist's upcoming events straight out of /events.json
  // so the page never goes stale. Opt in with "show_events": true.
  async function eventLinks(artist) {
    if (!artist.show_events) return [];
    let events;
    try {
      events = await fetch('/events.json').then(r => r.json());
    } catch (_) { return []; }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return events
      .filter(e => new Date(e.date_iso).getTime() >= cutoff)
      .filter(e => !Array.isArray(artist.event_ids) || artist.event_ids.includes(e.id))
      .sort((a, b) => a.date_iso.localeCompare(b.date_iso))
      .map(e => ({
        label: e.name,
        url: `/events/${e.id}/`,
        icon: 'ticket',
        note: [e.date_display, e.venue].filter(Boolean).join(' · '),
      }));
  }

  async function render() {
    const slug = currentSlug();
    let artists;
    try {
      artists = await fetch('/artists.json').then(r => r.json());
    } catch (_) {
      el.innerHTML = '<div class="empty-note">Could not load artist.</div>';
      return;
    }

    const artist = artists.find(a => a.id === slug);
    if (!artist) {
      el.innerHTML = '<div class="empty-note">Artist not found.</div>';
      return;
    }

    document.title = artist.name;

    const links = (await eventLinks(artist)).concat(artist.links || []);

    el.innerHTML = [
      `<img src="/artists/${esc(slug)}/logo.webp" alt="${esc(artist.name)}" class="artist-logo"
        onerror="this.style.display='none'">`,
      `<div class="artist-header">
        <div class="artist-name">${esc(artist.name)}</div>
        ${artist.tagline ? `<div class="artist-tagline">${esc(artist.tagline)}</div>` : ''}
      </div>`,
      artist.bio ? `<p class="artist-bio">${linkifyEmails(esc(artist.bio))}</p>` : '',
      embedHtml(artist.embed, artist.accent_color),
      links.length
        ? `<div class="links">${links.map(linkHtml).join('')}</div>`
        : '<div class="empty-note">Links coming soon.</div>',
      '<div class="artist-footer"><a href="https://synchronized.dance/">synchronized.dance</a></div>',
    ].join('');
  }

  window.trackArtistLink = function (label) {
    if (typeof gtag === 'function') {
      gtag('event', 'artist_link_click', { event_category: 'engagement', event_label: label });
    }
  };

  render();
})();
