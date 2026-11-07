const mobile = window.matchMedia('(max-width: 720px)');
let gesture = null;
let suppressClickUntil = 0;

function setOpen(open) {
  const sidebar = document.querySelector('#sidebar');
  const button = document.querySelector('#mobileMenu');
  const backdrop = document.querySelector('#menuBackdrop');
  const restoreFocus =
    sidebar.contains(document.activeElement) || gesture?.dragging;
  if (gesture?.dragging) {
    // Commit the finger's last position before restoring CSS transitions.
    sidebar.getBoundingClientRect();
    getComputedStyle(backdrop).opacity;
  }
  gesture = null;
  sidebar.classList.remove('dragging');
  sidebar.style.removeProperty('transform');
  backdrop.classList.remove('dragging');
  backdrop.style.removeProperty('opacity');
  open = mobile.matches && open;
  sidebar.classList.toggle('show', open);
  sidebar.inert = mobile.matches && !open;
  backdrop.classList.toggle('show', open);
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
  const backdrop = document.querySelector('#menuBackdrop');
  const isOpen = () => sidebar.classList.contains('show');
  const cancelGesture = () => {
    if (gesture?.dragging) {
      suppressClickUntil = performance.now() + 400;
      setOpen(gesture.open);
    } else gesture = null;
  };
  const moveGesture = (touch, time) => {
    const delta = touch.clientX - gesture.lastX;
    if (delta) gesture.velocity = delta / Math.max(1, time - gesture.lastTime);
    if (delta) gesture.lastTime = time;
    gesture.lastX = touch.clientX;
    const offset = Math.max(
      -gesture.width,
      Math.min(0, gesture.offset + touch.clientX - gesture.x),
    );
    gesture.progress = 1 + offset / gesture.width;
    sidebar.style.transform = `translate3d(${offset}px, 0, 0)`;
    backdrop.style.opacity = String(gesture.progress);
  };
  button.addEventListener('click', () => setOpen(!isOpen()));
  backdrop.addEventListener('click', closeMobileMenu);
  mobile.addEventListener('change', () => {
    closeMobileMenu();
  });
  closeMobileMenu();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && gesture?.dragging) {
      event.preventDefault();
      suppressClickUntil = performance.now() + 400;
      closeMobileMenu();
      return;
    }
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
      cancelGesture();
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
        open,
        lastX: touch.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
        dragging: false,
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
        cancelGesture();
        return;
      }
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (
        !gesture.dragging &&
        Math.abs(dy) > 12 &&
        Math.abs(dy) >= Math.abs(dx)
      ) {
        gesture = null;
        return;
      }
      if (
        !gesture.dragging &&
        Math.abs(dx) > 12 &&
        Math.abs(dx) > Math.abs(dy) * 1.5 &&
        (gesture.open ? dx < 0 : dx > 0)
      ) {
        // Include the off-screen shadow in the closed position. Read the
        // rendered position so an in-flight button animation can be grabbed.
        gesture.width = sidebar.offsetWidth + 32;
        gesture.offset = Math.max(
          -gesture.width,
          Math.min(0, sidebar.getBoundingClientRect().left),
        );
        gesture.dragging = true;
        sidebar.classList.add('dragging');
        backdrop.classList.add('dragging');
        document.body.classList.add('menu-open');
        document.querySelector('.app-main').inert = true;
      }
      if (gesture.dragging) {
        if (event.cancelable) event.preventDefault();
        moveGesture(touch, event.timeStamp);
      }
    },
    { passive: false },
  );

  document.addEventListener(
    'touchend',
    (event) => {
      const start = gesture;
      if (!start) return;
      if (event.touches.length || start.open !== isOpen()) {
        cancelGesture();
        return;
      }
      const touch = [...event.changedTouches].find(
        (item) => item.identifier === start.id,
      );
      if (!touch || !start.dragging) {
        cancelGesture();
        return;
      }
      moveGesture(touch, event.timeStamp);
      if (event.cancelable) event.preventDefault();
      suppressClickUntil = performance.now() + 400;
      const velocity =
        event.timeStamp - start.lastTime > 100 ? 0 : start.velocity;
      const flick =
        Math.abs(touch.clientX - start.x) >= 60 && Math.abs(velocity) >= 0.45;
      setOpen(flick ? velocity > 0 : start.progress >= 0.5);
    },
    { passive: false },
  );
  document.addEventListener('touchcancel', cancelGesture, { passive: true });
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
