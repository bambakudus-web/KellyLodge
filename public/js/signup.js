// signup.js: handles the signup form submission

const form = document.getElementById('signup-form');
const errorBox = document.getElementById('form-error');

const params = new URLSearchParams(window.location.search);
const presetRole = params.get('role');
if (presetRole === 'hoster') {
  document.getElementById('role-hoster').checked = true;
} else if (presetRole === 'student') {
  document.getElementById('role-student').checked = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.style.display = 'none';

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  const phoneDigits = String(payload.phone || '').replace(/\D/g, '');
  const isValidGhanaPhone = /^0\d{9}$/.test(phoneDigits) || /^233\d{9}$/.test(phoneDigits);
  if (!isValidGhanaPhone) {
    errorBox.textContent = 'Enter a valid Ghanaian phone number, e.g. 0551234567 or +233551234567.';
    errorBox.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || 'Could not create account.';
      errorBox.style.display = 'block';
      return;
    }

    form.innerHTML = `<p class="form-success" style="display:block;">${data.message}</p>`;
  } catch (err) {
    console.error(err);
    errorBox.textContent = 'Could not reach the server. Please try again.';
    errorBox.style.display = 'block';
  }
});
