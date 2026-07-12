// nav.js: shared across all pages. Checks session state and renders the nav accordingly.

// Self-contained escape helper, nav.js runs on pages that don't load area.js
// (landing, login, signup), so it can't rely on that file's escapeHTML.
function navEscapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Small monochrome line icons (currentColor, so they inherit each link's
// text color automatically in every state: default, hover, mobile, desktop).
const NAV_ICONS = {
  browse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  post: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-6"/></svg>',
  payout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>',
  bookings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  favorites: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.6-9.5-9A5.5 5.5 0 0112 5a5.5 5.5 0 019.5 7c-2.5 4.4-9.5 9-9.5 9z"/></svg>',
  account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  signup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3.5-6 7-6M17 8v6M20 11h-6"/></svg>',
};

function navLink(href, iconName, label, extraClass) {
  return `<a href="${href}"${extraClass ? ` class="${extraClass}"` : ''} data-tooltip="${label}"><span class="nav-icon">${NAV_ICONS[iconName]}</span><span class="nav-link-label">${label}</span></a>`;
}

// Lets every page tell a fresh, never-logged-in visitor apart from someone
// whose session just expired from inactivity, so the "please log in" gate
// can say something more accurate than a flat "access restricted" either way.
const LOGGED_IN_FLAG = 'kl_was_logged_in';

function markLoggedIn() {
  try { localStorage.setItem(LOGGED_IN_FLAG, '1'); } catch { /* private browsing, etc. */ }
}
function clearLoggedInFlag() {
  try { localStorage.removeItem(LOGGED_IN_FLAG); } catch { /* private browsing, etc. */ }
}
function wasRecentlyLoggedIn() {
  try { return localStorage.getItem(LOGGED_IN_FLAG) === '1'; } catch { return false; }
}
// Exposed globally so each page's own script (account.js, dashboard.js, etc.)
// can use it in their own gate() without importing anything.
window.wasRecentlyLoggedIn = wasRecentlyLoggedIn;
window.clearLoggedInFlag = clearLoggedInFlag;

async function getCurrentUser() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    if (data.user) markLoggedIn();
    return data.user;
  } catch (err) {
    console.error('Could not check login state:', err);
    return null;
  }
}

function renderNav(user) {
  const header = document.querySelector('.site-header');
  const nav = document.getElementById('site-nav');
  if (!nav || !header) return;

  const topLinks = [navLink('/index.html', 'browse', 'Browse')];

  if (!user) {
    topLinks.push(navLink('/login.html', 'login', 'Log in'));
    topLinks.push(navLink('/signup.html', 'signup', 'Sign up', 'cta'));

    nav.innerHTML = `<div class="nav-links">${topLinks.join('')}</div>`;
  } else {
    const menuLinks = [];
    if (user.role === 'student') menuLinks.push(navLink('/mybookings.html', 'bookings', 'My Bookings'));
    if (user.role === 'student') menuLinks.push(navLink('/favorites.html', 'favorites', 'Favorites'));
    if (user.role === 'hoster') menuLinks.push(navLink('/post.html', 'post', 'Post a listing'));
    if (user.role === 'hoster') menuLinks.push(navLink('/dashboard.html', 'dashboard', 'Dashboard'));
    if (user.role === 'hoster') menuLinks.push(navLink('/payout-settings.html', 'payout', 'Payout Settings'));
    if (user.role === 'admin') menuLinks.push(navLink('/admin.html', 'admin', 'Admin'));
    menuLinks.push(navLink('/account.html', 'account', 'Account'));

    nav.innerHTML = `
      <div class="nav-links">${topLinks.join('')}</div>
      <div class="nav-user">
        <button type="button" class="nav-user-trigger" id="nav-user-trigger" aria-haspopup="true" aria-expanded="false">
          <span class="who">${navEscapeHTML(user.name)}</span>
          <span class="badge">${user.role}</span>
          <span class="chevron">&#9662;</span>
        </button>
        <div class="nav-dropdown" id="nav-dropdown">
          ${menuLinks.join('')}
          <div class="nav-dropdown-divider"></div>
          <button type="button" id="logout-btn" data-tooltip="Log out"><span class="nav-icon">${NAV_ICONS.logout}</span><span class="nav-link-label">Log out</span></button>
        </div>
      </div>
    `;
  }

  if (user) {
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      clearLoggedInFlag();
      window.location.href = '/landing.html';
    });

    // Desktop dropdown: toggle on click, close on an outside click.
    const trigger = document.getElementById('nav-user-trigger');
    const dropdown = document.getElementById('nav-dropdown');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(isOpen));
    });
    document.addEventListener('click', (e) => {
      if (dropdown.classList.contains('open') && !dropdown.contains(e.target) && e.target !== trigger) {
        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Hamburger toggle + backdrop for small screens, only build them once
  if (!header.querySelector('.nav-toggle')) {
    const toggle = document.createElement('button');
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-label', 'Toggle menu');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    header.appendChild(toggle);

    const backdrop = document.createElement('div');
    backdrop.className = 'nav-backdrop';
    document.body.appendChild(backdrop);

    function closeDrawer() {
      nav.classList.remove('open');
      toggle.classList.remove('open');
      backdrop.classList.remove('open');
    }
    function openDrawer() {
      nav.classList.add('open');
      toggle.classList.add('open');
      backdrop.classList.add('open');
    }

    toggle.addEventListener('click', () => {
      if (nav.classList.contains('open')) closeDrawer();
      else openDrawer();
    });
    backdrop.addEventListener('click', closeDrawer);

    // Close the drawer whenever a real nav link/action is tapped, but not
    // the dropdown trigger itself (that would close the whole drawer
    // instead of just revealing the dropdown's contents).
    nav.addEventListener('click', (e) => {
      const el = e.target.closest('.nav-links a, .nav-dropdown a, .nav-dropdown button');
      if (el) closeDrawer();
    });
  }

  if (user) loadChatWidget(user);
}

// The floating chat bubble lives outside any single page, so it's loaded
// here, once, on every page a logged-in user visits, rather than needing a
// dedicated Messages page or a <script> tag added to every HTML file.
function loadChatWidget(user) {
  if (window.KellyLodgeChatWidget) {
    window.KellyLodgeChatWidget.init(user);
    return;
  }

  const script = document.createElement('script');
  script.src = '/js/chat-widget.js';
  script.onload = () => window.KellyLodgeChatWidget?.init(user);
  document.body.appendChild(script);
}

async function initNav() {
  const user = await getCurrentUser();
  renderNav(user);
  return user;
}

initNav();
