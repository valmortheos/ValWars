/**
 * UI & Toast Helpers
 */
export function showToast(message, duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, duration);
}

export function lockOrientation(mode) {
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock(mode).catch((err) => {
      // Best-effort orientation lock: ignore browser rejection on non-fullscreen
    });
  }
}
