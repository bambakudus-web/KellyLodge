// verify-email.js — calls the verification endpoint using the token in the URL

const container = document.getElementById('verify-container');

async function verify() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    container.innerHTML = '<p class="state-message">No verification token found in this link.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`);
    const data = await res.json();

    if (!res.ok) {
      container.innerHTML = `<p class="state-message">${data.error || 'Could not verify your email.'}</p>`;
      return;
    }

    container.innerHTML = `
      <p class="state-message">${data.message}</p>
      <a href="/login.html" class="btn btn-gold">Go to login</a>
    `;
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="state-message">Could not reach the server. Please try again.</p>';
  }
}

verify();
