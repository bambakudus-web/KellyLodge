// account.js: lets any logged-in user (student, hoster, admin) manage their profile and password

const container = document.getElementById('account-container');

function gate(message) {
  container.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>Access restricted</h2>
      <p>${message}</p>
      <a href="/login.html" class="btn btn-gold">Log in</a>
    </div>
  `;
}

function formHTML(user) {
  return `
    <div class="form-wrap">
      <h2>Profile</h2>
      <div class="form-error" id="profile-error"></div>
      <div class="form-success" id="profile-success"></div>

      <form id="profile-form">
        <div class="form-group">
          <label for="name">Full name</label>
          <input type="text" id="name" name="name" value="${user.name}" required />
        </div>
        <div class="form-group">
          <label for="phone">Phone number</label>
          <input type="tel" id="phone" name="phone" value="${user.phone || ''}" required />
        </div>
        <div class="form-group">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" value="${user.email}" required />
          <span class="form-note">Changing this will require you to verify the new email before you can log in again.</span>
        </div>
        <button type="submit" class="btn btn-gold btn-block">Save profile</button>
      </form>
    </div>

    <div class="form-wrap">
      <h2>Change password</h2>
      <div class="form-error" id="password-error"></div>
      <div class="form-success" id="password-success"></div>

      <form id="password-form">
        <div class="form-group">
          <label for="currentPassword">Current password</label>
          <input type="password" id="currentPassword" name="currentPassword" required />
        </div>
        <div class="form-group">
          <label for="newPassword">New password</label>
          <input type="password" id="newPassword" name="newPassword" minlength="6" required />
          <span class="form-note">At least 6 characters.</span>
        </div>
        <button type="submit" class="btn btn-outline btn-block">Change password</button>
      </form>
    </div>
  `;
}

function attachProfileForm() {
  const form = document.getElementById('profile-form');
  const errorBox = document.getElementById('profile-error');
  const successBox = document.getElementById('profile-success');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const email = document.getElementById('email').value.trim();

    try {
      const res = await secureFetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email }),
      });
      const data = await res.json();

      if (!res.ok) {
        errorBox.textContent = data.error || 'Could not update profile.';
        errorBox.style.display = 'block';
        return;
      }

      successBox.textContent = data.message;
      successBox.style.display = 'block';
    } catch (err) {
      console.error(err);
      errorBox.textContent = 'Could not reach the server. Please try again.';
      errorBox.style.display = 'block';
    }
  });
}

function attachPasswordForm() {
  const form = document.getElementById('password-form');
  const errorBox = document.getElementById('password-error');
  const successBox = document.getElementById('password-success');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    successBox.style.display = 'none';

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;

    try {
      const res = await secureFetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        errorBox.textContent = data.error || 'Could not change password.';
        errorBox.style.display = 'block';
        return;
      }

      successBox.textContent = data.message;
      successBox.style.display = 'block';
      form.reset();
    } catch (err) {
      console.error(err);
      errorBox.textContent = 'Could not reach the server. Please try again.';
      errorBox.style.display = 'block';
    }
  });
}

async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await res.json();

  if (!user) return gate('You need to log in to manage your account.');

  container.innerHTML = formHTML(user);
  attachProfileForm();
  attachPasswordForm();
}

init();
