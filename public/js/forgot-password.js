// forgot-password.js — submits the forgot-password form

const form = document.getElementById('forgot-form');
const errorBox = document.getElementById('form-error');
const successBox = document.getElementById('form-success');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  const email = document.getElementById('email').value.trim();

  try {
    const res = await secureFetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || 'Something went wrong. Please try again.';
      errorBox.style.display = 'block';
      return;
    }

    form.innerHTML = '';
    successBox.textContent = data.message;
    successBox.style.display = 'block';
  } catch (err) {
    console.error(err);
    errorBox.textContent = 'Could not reach the server. Please try again.';
    errorBox.style.display = 'block';
  }
});
