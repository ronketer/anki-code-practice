import {javascriptWorker} from './worker.mjs';

export function createRunner(onState, limits = {run: 5000, test: 10000}) {
  let active = null;
  function finish(request, error, result) {
    if (active !== request) return;
    active = null;
    clearTimeout(request.timer);
    request.worker?.terminate();
    if (request.url) URL.revokeObjectURL(request.url);
    onState('JavaScript idle');
    if (error) request.reject(new Error(error));
    else request.resolve(result);
  }
  return {
    run(payload) {
      if (active) return Promise.reject(new Error('Already running'));
      return new Promise((resolve, reject) => {
        const request = active = {resolve, reject};
        onState('Running…');
        try {
          request.url = URL.createObjectURL(new Blob(['(' + javascriptWorker.toString() + ')()'], {type: 'text/javascript'}));
          request.worker = new Worker(request.url);
          request.worker.onmessage = ({data}) => finish(request, null, data);
          request.worker.onerror = event => { event.preventDefault(); finish(request, event.message || 'JavaScript worker failed.'); };
          request.worker.onmessageerror = () => finish(request, 'JavaScript worker communication failed.');
          request.timer = setTimeout(() => finish(request, 'Execution timed out. Run again to restart JavaScript.'), limits[payload.mode]);
          request.worker.postMessage(payload);
        } catch (error) { finish(request, 'Workers unavailable: ' + error.message); }
      });
    },
    stop() { if (active) finish(active, 'Execution stopped.'); },
    destroy() { if (active) finish(active, 'Card closed.'); }
  };
}
