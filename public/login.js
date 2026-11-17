const form = document.querySelector('#login-form');
const error = document.querySelector('#login-error');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.querySelector('#password').value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Sign-in failed.');
    window.location.assign('/');
  } catch (e) {
    error.textContent = e.message;
  } finally {
    button.disabled = false;
  }
});
