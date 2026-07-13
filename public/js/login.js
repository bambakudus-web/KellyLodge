// login.js: handles the login form submission

const form = document.getElementById('login-form');
const errorBox = document.getElementById('form-error');
const infoBox = document.getElementById('form-info');

// If nav.js's inactivity watcher just logged this person out, let them know
// why they're suddenly looking at a login screen, rather than leaving it
// unexplained.
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('reason') === 'inactivity') {
  infoBox.textContent = "You've been logged out after 5 minutes of inactivity, for your security. Log back in to continue.";
  infoBox.style.display = 'block';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.style.display = 'none';

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || 'Could not log in.';
      errorBox.style.display = 'block';
      return;
    }

    // Redirect based on role
    if (data.user.role === 'admin') {
      window.location.href = '/admin.html';
    } else {
      window.location.href = '/index.html';
    }
  } catch (err) {
    console.error(err);
    errorBox.textContent = 'Could not reach the server. Please try again.';
    errorBox.style.display = 'block';
  }
});
