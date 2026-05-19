export function showToast(message, level = 'info') {
  const id = 'app-toast';
  let container = document.getElementById(id);
  if (!container) {
    container = document.createElement('div');
    container.id = id;
    container.style.position = 'fixed';
    container.style.right = '16px';
    container.style.bottom = '16px';
    container.style.zIndex = '100000';
    document.body.appendChild(container);
  }

  const item = document.createElement('div');
  item.textContent = message;
  item.style.marginTop = '8px';
  item.style.padding = '10px 12px';
  item.style.borderRadius = '8px';
  item.style.fontWeight = 'bold';
  item.style.fontSize = '12px';
  item.style.background = level === 'error' ? '#7a0f1f' : level === 'warn' ? '#6a4300' : '#10314a';
  item.style.color = '#f0f7ff';
  container.appendChild(item);

  setTimeout(() => item.remove(), 3500);
}

export function updateConnectionBadge(elementId, online, text) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = text;
  el.style.background = online ? '#0a0' : '#a00';
}
