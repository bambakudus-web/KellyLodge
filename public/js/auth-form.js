// auth-form.js: shared behavior for auth pages (login, signup). Currently
// just the password show/hide toggle, so it's a small enough file to load
// on both pages without a build step.

document.querySelectorAll('.password-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.getAttribute('data-target'));
    if (!input) return;

    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  });
});
