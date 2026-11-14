// One run at a time (state.js reload): pure, so it is tested on its own (tests/js/serial.test.mjs).

/**
 * `fn` (async, no arguments) wrapped so that runs never overlap: a call while it runs is run once more after that run
 * ends, every call in between sharing that one run. Each call's promise settles when a run that started after the call
 * ends — so what it answers is never older than the call — and runs end in the order they started.
 */
export function serial(fn) {
  let running = null;
  let queued = null;
  const call = () => {
    if (!running) {
      running = Promise.resolve().then(fn).finally(() => { running = null; });
      return running;
    }
    if (!queued) {
      const again = () => { queued = null; return call(); };
      queued = running.then(again, again);
    }
    return queued;
  };
  return call;
}
