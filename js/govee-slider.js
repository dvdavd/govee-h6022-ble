class TrackSlider extends HTMLElement {
  static geometry = {
    trackHeight: 24,
    trackRadius: 12,
    fillInset: 3,
    fillHeight: 16,
    fillRadius: 8,
    minThumbWidth: 16,
  };

  static get observedAttributes() {
    return ['min', 'max', 'step', 'value', 'gradient'];
  }

  connectedCallback() {
    if (this.shadowRoot) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const gradient = this.getAttribute('gradient');
    const g = TrackSlider.geometry;

    shadow.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :host { display: block; }
        .track {
          position: relative;
          height: ${g.trackHeight}px;
          border-radius: ${g.trackRadius}px;
          background: var(--sunk);
          border: 1px solid var(--border);
          cursor: pointer;
          touch-action: none;
        }
        .fill {
          position: absolute;
          top: ${g.fillInset}px;
          left: ${g.fillInset}px;
          height: ${g.fillHeight}px;
          min-width: ${g.minThumbWidth}px;
          border-radius: ${g.fillRadius}px;
          pointer-events: none;
          background: ${gradient ?? 'var(--accent)'};
          ${gradient ? 'background-size: 200px 100%; background-repeat: no-repeat;' : ''}
        }
        input {
          -webkit-appearance: none;
          appearance: none;
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          pointer-events: none;
          margin: 0;
          padding: 0;
        }
        input::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 1px 3px rgba(0,0,0,.5);
        }
        input::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: none;
          border-radius: 50%;
          background: var(--accent);
        }
      </style>
      <div class="track">
        <div class="fill"></div>
        <input type="range"
          min="${this.getAttribute('min') ?? 0}"
          max="${this.getAttribute('max') ?? 100}"
          step="${this.getAttribute('step') ?? 1}"
          value="${this.getAttribute('value') ?? 50}">
      </div>`;

    this._track = shadow.querySelector('.track');
    this._fill  = shadow.querySelector('.fill');
    this._input = shadow.querySelector('input');

    this._track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._input.focus();
      this._track.setPointerCapture(e.pointerId);
      this._setValueFromPointer(e.clientX);
    });
    this._track.addEventListener('pointermove', (e) => {
      if (!this._track.hasPointerCapture(e.pointerId)) return;
      e.preventDefault();
      this._setValueFromPointer(e.clientX);
    });
    this._track.addEventListener('pointerup', (e) => {
      if (!this._track.hasPointerCapture(e.pointerId)) return;
      this._track.releasePointerCapture(e.pointerId);
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    });
    this._track.addEventListener('pointercancel', (e) => {
      if (this._track.hasPointerCapture(e.pointerId)) {
        this._track.releasePointerCapture(e.pointerId);
      }
    });
    this._input.addEventListener('input', () => {
      this._updateFill();
      this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    });
    this._input.addEventListener('change', () => {
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    });

    this._ro = new ResizeObserver(() => this._updateFill());
    this._ro.observe(this._track);
    this._updateFill();
  }

  disconnectedCallback() {
    this._ro?.disconnect();
  }

  attributeChangedCallback(name, _old, val) {
    if (!this._input) return;
    if (name === 'value') { this._input.value = val; this._updateFill(); }
    else if (name !== 'gradient') this._input.setAttribute(name, val);
  }

  get value() { return this._input?.value ?? this.getAttribute('value'); }
  set value(v) {
    if (this._input) { this._input.value = v; this._updateFill(); }
    else this.setAttribute('value', v);
  }

  _setValueFromPointer(clientX) {
    const rect = this._track.getBoundingClientRect();
    const g = TrackSlider.geometry;
    const trackPad = g.fillInset * 2 + 2;
    const start = rect.left + g.fillInset + g.minThumbWidth / 2;
    const end = rect.right - (trackPad - g.fillInset) - g.minThumbWidth / 2;
    const p = end > start
      ? Math.max(0, Math.min(1, (clientX - start) / (end - start)))
      : 0;
    const min = parseFloat(this._input.min) || 0;
    const max = parseFloat(this._input.max) || 100;
    const step = this._input.step === 'any' ? 0 : parseFloat(this._input.step || '1');
    let next = min + p * (max - min);
    if (step > 0) {
      next = Math.round((next - min) / step) * step + min;
    }
    next = Math.max(min, Math.min(max, next));
    const previous = this._input.value;
    this._input.value = String(next);
    this._updateFill();
    if (this._input.value !== previous) {
      this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
  }

  _updateFill() {
    const W = this._track.offsetWidth;
    if (!W) return;
    const g = TrackSlider.geometry;
    const trackPad = g.fillInset * 2 + 2;
    const min = parseFloat(this._input.min) || 0;
    const max = parseFloat(this._input.max) || 100;
    const rawP = (parseFloat(this._input.value) - min) / (max - min);
    const p = Math.max(0, Math.min(1, rawP || 0));
    const fillRange = Math.max(0, W - trackPad - g.minThumbWidth);
    const fillW = g.minThumbWidth + p * fillRange;
    this._fill.style.width = fillW + 'px';
    if (this.getAttribute('gradient')) {
      this._fill.style.backgroundSize = (W - trackPad) + 'px 100%';
    }
  }
}

customElements.define('track-slider', TrackSlider);
