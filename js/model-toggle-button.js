/**
 * model-toggle-button.js — viewer chip that toggles a model's visibility on
 * click and sets its opacity on horizontal drag.
 *
 * Vanilla port of form-fit-print/frontend/src/components/viewer/ModelToggleButton.jsx;
 * keep the two in step so the viewer chips behave the same across apps.
 */

/**
 * @param {object} props
 * @param {string} props.label
 * @param {boolean} props.active
 * @param {string} props.color      hex color, e.g. '#f5c242'
 * @param {number} props.opacity    0.1–1
 * @param {() => void} props.onToggle
 * @param {(opacity: number) => void} props.onOpacityChange
 * @returns {{ el: HTMLButtonElement, update: (props: object) => void }}
 */
export function createModelToggleButton(initialProps) {
  let props = { ...initialProps };
  let drag = null;

  const el = document.createElement('button');
  el.className = 'viewer-chip';
  el.type = 'button';

  function render() {
    const { label, active, color } = props;
    el.textContent = label;
    Object.assign(el.style, {
      background: active ? `${color}33` : 'var(--overlay-btn-inactive)',
      border: `1px solid ${active ? color : 'var(--border-input)'}`,
      borderRadius: '4px',
      padding: '4px 8px',
      fontSize: '11px',
      color: active ? color : 'var(--text-dim)',
      cursor: 'ew-resize',
      userSelect: 'none',
    });
  }

  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    drag = {
      startX: e.clientX,
      startOpacity: props.opacity,
      dragged: false,
    };

    const handleMouseMove = (e) => {
      if (!drag) return;
      const deltaX = e.clientX - drag.startX;
      if (Math.abs(deltaX) > 5) {
        drag.dragged = true;
        const newOpacity = Math.min(1, Math.max(0.1, drag.startOpacity + deltaX / 200));
        props.onOpacityChange(newOpacity);
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (drag && !drag.dragged) {
        props.onToggle();
      }
      drag = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  });

  render();

  return {
    el,
    update(next) {
      props = { ...props, ...next };
      render();
    },
  };
}
