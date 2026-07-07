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

async function getCurrentUser() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
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

  const links = [`<a href="/index.html">Browse</a>`];

  if (!user) {
    links.push(`<a href="/login.html">Log in</a>`);
    links.push(`<a href="/signup.html" class="cta">Sign up</a>`);
  } else {
    if (user.role === 'student') links.push(`<a href="/mybookings.html">My Bookings</a>`);
    if (user.role === 'student') links.push(`<a href="/favorites.html">Favorites</a>`);
    if (user.role === 'hoster') links.push(`<a href="/post.html">Post a listing</a>`);
    if (user.role === 'hoster') links.push(`<a href="/dashboard.html">Dashboard</a>`);
    if (user.role === 'admin') links.push(`<a href="/admin.html">Admin</a>`);
    links.push(`<a href="/account.html">Account</a>`);
  }

  const userBlockHTML = user ? `
    <span class="nav-user">
      <span class="who">${navEscapeHTML(user.name)}<span class="badge">${user.role}</span></span>
      <button id="logout-btn">Log out</button>
    </span>
  ` : '';

  nav.innerHTML = `
    <div class="nav-links">${links.join('')}</div>
    ${userBlockHTML}
  `;

  if (user) {
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/landing.html';
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

  // Close the mobile menu whenever a nav link is tapped
  nav.querySelectorAll('a, button').forEach((el) => {
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
