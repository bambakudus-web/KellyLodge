// reset-password.js: reads the token from the URL and submits a new password

const form = document.getElementById('reset-form');
const errorBox = document.getElementById('form-error');
const successBox = document.getElementById('form-success');

function getTokenFromUrl() {
  return new URLSearchParams(window.location.search).get('token');
}

const token = getTokenFromUrl();
if (!token) {
  form.style.display = 'none';
  errorBox.textContent = 'No reset token found in this link. Please use the link from your email.';
  errorBox.style.display = 'block';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (newPassword !== confirmPassword) {
    errorBox.textContent = 'Passwords do not match.';
    errorBox.style.display = 'block';
    return;
  }

  try {
    const res = await secureFetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || 'Could not reset your password.';
      errorBox.style.display = 'block';
      return;
    }

    form.style.display = 'none';
    successBox.innerHTML = `${data.message} <a href="/login.html">Log in</a>`;
    successBox.style.display = 'block';
  } catch (err) {
    console.error(err);
    errorBox.textContent = 'Could not reach the server. Please try again.';
    errorBox.style.display = 'block';
  }
});
