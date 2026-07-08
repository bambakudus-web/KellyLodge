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

  const topLinks = [`<a href="/index.html">Browse</a>`];

  if (!user) {
    topLinks.push(`<a href="/login.html">Log in</a>`);
    topLinks.push(`<a href="/signup.html" class="cta">Sign up</a>`);

    nav.innerHTML = `<div class="nav-links">${topLinks.join('')}</div>`;
  } else {
    const menuLinks = [];
    if (user.role === 'student') menuLinks.push(`<a href="/mybookings.html">My Bookings</a>`);
    if (user.role === 'student') menuLinks.push(`<a href="/favorites.html">Favorites</a>`);
    if (user.role === 'hoster') menuLinks.push(`<a href="/post.html">Post a listing</a>`);
    if (user.role === 'hoster') menuLinks.push(`<a href="/dashboard.html">Dashboard</a>`);
    if (user.role === 'admin') menuLinks.push(`<a href="/admin.html">Admin</a>`);
    menuLinks.push(`<a href="/account.html">Account</a>`);

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
          <button type="button" id="logout-btn">Log out</button>
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

  // Hamburger toggle for small screens, only build it once
  if (!header.querySelector('.nav-toggle')) {
    const toggle = document.createElement('button');
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-label', 'Toggle menu');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    toggle.addEventListener('click', () => {
      nav.classList.toggle('open');
      toggle.classList.toggle('open');
    });
    header.appendChild(toggle);
  }

  // Close the mobile menu whenever a real nav link/action is tapped, but not
  // the dropdown trigger itself (that would close the whole mobile menu
  // instead of just revealing the dropdown's contents).
  nav.querySelectorAll('.nav-links a, .nav-dropdown a, .nav-dropdown button').forEach((el) => {
    el.addEventListener('click', () => {
      nav.classList.remove('open');
      header.querySelector('.nav-toggle')?.classList.remove('open');
    });
  });
}

async function initNav() {
  const user = await getCurrentUser();
  renderNav(user);
  return user;
}

initNav();
