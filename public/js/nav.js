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
  return `<a href="${href}" class="nav-item${extraClass ? ' ' + extraClass : ''}" data-tooltip="${label}"><span class="nav-icon">${NAV_ICONS[iconName]}</span><span class="nav-link-label">${label}</span></a>`;
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

async function doLogout(reason) {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch { /* logging out anyway, don't block on this */ }
  clearLoggedInFlag();
  window.location.href = reason ? `/login.html?reason=${reason}` : '/landing.html';
}

function renderNav(user) {
  const header = document.querySelector('.site-header');
  const nav = document.getElementById('site-nav');
  if (!nav || !header) return;

  if (!user) {
    // Same nav-item markup style logged-in users get (not the old plain
    // <a> tags), so the mobile drawer CSS — which only shows #site-nav
    // once the hamburger's .open class is toggled — has something
    // consistent to work with for guests too.
    nav.innerHTML = `
      <div class="nav-links">
        ${navLink('/index.html', 'browse', 'Browse')}
        ${navLink('/login.html', 'login', 'Log in')}
        ${navLink('/signup.html', 'signup', 'Sign up')}
      </div>
    `;
  } else {
    // One flat list, authored in exactly the order the mobile drawer wants
    // top-to-bottom (profile header, then Browse, then everything else, then
    // Log out last). Desktop rearranges this same markup visually with CSS
    // `order`, rather than needing a second, separate structure.
    const items = [navLink('/index.html', 'browse', 'Browse')];
    if (user.role === 'student') items.push(navLink('/mybookings.html', 'bookings', 'My Bookings'));
    if (user.role === 'student') items.push(navLink('/favorites.html', 'favorites', 'Favorites'));
    if (user.role === 'hoster') items.push(navLink('/post.html', 'post', 'Post a listing'));
    if (user.role === 'hoster') items.push(navLink('/dashboard.html', 'dashboard', 'Dashboard'));
    if (user.role === 'hoster') items.push(navLink('/payout-settings.html', 'payout', 'Payout Settings'));
    if (user.role === 'admin') items.push(navLink('/admin.html', 'admin', 'Admin'));
    items.push(navLink('/account.html', 'account', 'Account'));

    nav.innerHTML = `
      <div class="nav-profile-header">
        <span class="who">${navEscapeHTML(user.name)}</span>
        <span class="badge">${user.role}</span>
      </div>
      ${items.join('')}
      <button type="button" class="nav-item nav-logout" id="logout-btn" data-tooltip="Log out">
        <span class="nav-icon">${NAV_ICONS.logout}</span><span class="nav-link-label">Log out</span>
      </button>
    `;

    document.getElementById('logout-btn').addEventListener('click', () => doLogout());
    loadChatWidget(user);
    startInactivityWatch();
  }

  // Hamburger toggle + backdrop for small screens, built once regardless of
  // login state, a guest needs a way to open the drawer and see Log in /
  // Sign up just as much as a logged-in user needs it for their own links.
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

    nav.addEventListener('click', (e) => {
      if (e.target.closest('.nav-item') || e.target.closest('.nav-links a')) closeDrawer();
    });
  }
}

// Logs the user out automatically after 5 minutes with no interaction
// anywhere in the app (mouse movement, clicks, key presses, scrolling, or
// touches all count as activity). Paired with a matching server-side
// rolling session timeout (see server.js), so this isn't just a client-side
// suggestion, the session itself actually expires on the same schedule.
const INACTIVITY_LIMIT_MS = 20 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000; // keep the server session's rolling window alive
let inactivityWatchStarted = false;

function startInactivityWatch() {
  if (inactivityWatchStarted) return;
  inactivityWatchStarted = true;

  let lastActivity = Date.now();
  let lastHeartbeat = Date.now();

  const markActive = () => {
    lastActivity = Date.now();

    // A request only reaches the server here, not on every single
    // mousemove, so genuine activity keeps the server-side rolling session
    // alive without spamming it with a request per pixel of mouse movement.
    if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat = Date.now();
      fetch('/api/auth/me', { credentials: 'include' }).catch(() => {});
    }
  };

  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) => {
    document.addEventListener(evt, markActive, { passive: true });
  });

  setInterval(() => {
    if (Date.now() - lastActivity >= INACTIVITY_LIMIT_MS) {
      doLogout('inactivity');
    }
  }, 15000);
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
