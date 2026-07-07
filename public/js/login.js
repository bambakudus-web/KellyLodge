// login.js: handles the login form submission

const form = document.getElementById('login-form');
const errorBox = document.getElementById('form-error');

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
