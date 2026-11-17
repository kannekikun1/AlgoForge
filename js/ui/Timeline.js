/**
 * Bottom panel: transport buttons, timeline scrubber, speed slider and messages.
 * Speed slider maps 0–100 logarithmically to 0.5–500 events per second.
 */
export const speedFromSlider = (v) => Math.round(0.5 * 1000 ** (v / 100) * 100) / 100;
export const sliderFromSpeed = (s) => Math.round((Math.log(s / 0.5) / Math.log(1000)) * 100);

export class Timeline {
  constructor(controller, { onSpeed = () => {} } = {}) {
    this.ctl = controller;
    this.el = {
      restart: document.getElementById('pb-restart'),
      back: document.getElementById('pb-back'),
      play: document.getElementById('pb-play'),
      forward: document.getElementById('pb-forward'),
      end: document.getElementById('pb-end'),
      stop: document.getElementById('pb-stop'),
      range: document.getElementById('pb-timeline'),
      label: document.getElementById('pb-label'),
      speed: document.getElementById('pb-speed'),
      speedValue: document.getElementById('pb-speed-value'),
      msg: document.getElementById('bottom-msg'),
    };
    const c = this.ctl;
    this.el.restart.addEventListener('click', () => c.restart());
    this.el.back.addEventListener('click', () => c.stepBackward());
    this.el.play.addEventListener('click', () => c.toggle());
    this.el.forward.addEventListener('click', () => c.stepForward());
    this.el.end.addEventListener('click', () => c.toEnd());
    this.el.stop.addEventListener('click', () => c.stop());
    this.el.range.addEventListener('input', () => { c.pause(); c.seek(Number(this.el.range.value)); });
    this.el.speed.addEventListener('input', () => {
      const s = speedFromSlider(Number(this.el.speed.value));
      c.setSpeed(s);
      onSpeed(s);
    });
    c.on('speed', (s) => this.#speedLabel(s));
    c.on('play', (playing) => {
      this.el.play.classList.toggle('playing', playing);
      this.el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    });
    c.on('change', () => this.render());
    this.#speedLabel(c.speed);
    this.render();
  }

  setSpeed(s) {
    this.el.speed.value = String(sliderFromSpeed(s));
    this.ctl.setSpeed(s);
  }

  #speedLabel(s) {
    const t = s >= 10 ? `${Math.round(s)}/s` : `${s}/s`;
    this.el.speedValue.textContent = t;
    this.el.speed.setAttribute('aria-valuetext', `${s} steps per second`);
  }

  render() {
    const c = this.ctl;
    const n = c.length;
    const has = n > 0;
    for (const k of ['restart', 'back', 'play', 'forward', 'end', 'stop']) this.el[k].disabled = !has;
    this.el.back.disabled = !has || c.index < 0;
    this.el.forward.disabled = !has || c.atEnd;
    this.el.end.disabled = !has || c.atEnd;
    this.el.range.max = String(Math.max(0, n - 1));
    this.el.range.value = String(c.index);
    this.el.range.disabled = !has;
    this.el.range.setAttribute('aria-valuetext', has ? `Step ${c.index + 1} of ${n}` : 'No trace');
    this.el.label.textContent = has ? `step ${c.index + 1} / ${n}` : 'No trace';
  }

  message(text, isError = false) {
    this.el.msg.textContent = text ?? '';
    this.el.msg.classList.toggle('is-error', Boolean(isError));
  }
}
