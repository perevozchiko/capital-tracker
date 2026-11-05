const mobile = window.matchMedia('(max-width: 720px)');
let gesture = null;
let suppressClickUntil = 0;

function setOpen(open) {
  const sidebar = document.querySelector('#sidebar');
  const button = document.querySelector('#mobileMenu');
  const restoreFocus = sidebar.contains(document.activeElement);
  open = mobile.matches && open;
  sidebar.classList.toggle('show', open);
  sidebar.inert = mobile.matches && !open;
  document.querySelector('#menuBackdrop').hidden = !open;
  document.querySelector('.app-main').inert = open;
  document.body.classList.toggle('menu-open', open);
  button.setAttribute('aria-expanded', String(open));
  if (open) sidebar.querySelector('.nav-item')?.focus({ preventScroll: true });
  else if (restoreFocus && mobile.matches)
    button.focus({ preventScroll: true });
}

export function closeMobileMenu() {
  setOpen(false);
}

export function bindMobileMenu() {
  const sidebar = document.querySelector('#sidebar');
  const button = document.querySelector('#mobileMenu');
  const isOpen = () => sidebar.classList.contains('show');
  button.addEventListener('click', () => setOpen(!isOpen()));
  document
    .querySelector('#menuBackdrop')
    .addEventListener('click', closeMobileMenu);
  mobile.addEventListener('change', () => {
    gesture = null;
    closeMobileMenu();
  });
  closeMobileMenu();

  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobileMenu();
    } else if (event.key === 'Tab') {
      const items = [
        ...sidebar.querySelectorAll(
          'button, a[href], select, input, [tabindex="0"]',
        ),
      ].filter((item) => !item.disabled && item.getClientRects().length);
      const next = event.shiftKey ? items.at(-1) : items[0];
      if (
        document.activeElement === (event.shiftKey ? items[0] : items.at(-1))
      ) {
        event.preventDefault();
        next?.focus();
      }
    }
  });

  document.addEventListener(
    'touchstart',
    (event) => {
      gesture = null;
      if (
        !mobile.matches ||
        event.touches.length !== 1 ||
        document.querySelector('dialog[open]')
      )
        return;
      const touch = event.touches[0];
      const open = isOpen();
      // Leave form controls, charts, draggable rows and horizontal tables alone.
      if (
        !open &&
        (touch.clientX > 48 ||
          event.target.closest(
            'input, select, textarea, button, a, [contenteditable], [draggable="true"], .table-scroll, .chart-wrap',
          ))
      )
        return;
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: event.timeStamp,
        open,
      };
    },
    { passive: true },
  );

  document.addEventListener(
    'touchmove',
    (event) => {
      if (!gesture) return;
      const touch = [...event.touches].find(
        (item) => item.identifier === gesture.id,
      );
      if (!touch || event.touches.length !== 1) {
        gesture = null;
        return;
      }
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
        gesture = null;
        return;
      }
      if (
        Math.abs(dx) > 12 &&
        Math.abs(dx) > Math.abs(dy) * 1.5 &&
        (gesture.open ? dx < 0 : dx > 0)
      ) {
        if (event.cancelable) event.preventDefault();
      }
    },
    { passive: false },
  );

  document.addEventListener(
    'touchend',
    (event) => {
      const start = gesture;
      gesture = null;
      if (!start || event.touches.length || start.open !== isOpen()) return;
      const touch = [...event.changedTouches].find(
        (item) => item.identifier === start.id,
      );
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (
        event.timeStamp - start.time > 700 ||
        Math.abs(dx) < 60 ||
        Math.abs(dx) < Math.abs(dy) * 1.5 ||
        (start.open ? dx >= 0 : dx <= 0)
      )
        return;
      if (event.cancelable) event.preventDefault();
      suppressClickUntil = performance.now() + 400;
      setOpen(!start.open);
    },
    { passive: false },
  );
  document.addEventListener(
    'touchcancel',
    () => {
      gesture = null;
    },
    { passive: true },
  );
  // A swipe ending over a navigation item must not activate it as a tap.
  document.addEventListener(
    'click',
    (event) => {
      if (event.detail > 0 && performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}
