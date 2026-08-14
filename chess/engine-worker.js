importScripts('./chess_engine.js');

let newGameFn, getBestMoveFn, applyMoveFn;

ChessEngineModule().then((Module) => {
  newGameFn = Module.cwrap('wasm_new_game', null, ['string']);
  getBestMoveFn = Module.cwrap('wasm_get_best_move', 'string', ['number']);
  applyMoveFn = Module.cwrap('wasm_apply_move', null, ['string']);
  postMessage({ type: 'ready' });
}).catch((err) => {
  postMessage({ type: 'error', message: String(err) });
});

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'newGame') {
    newGameFn('');
    if (msg.needEngineMove) {
      const move = getBestMoveFn(msg.movetimeMs);
      postMessage({ type: 'engineMove', move });
    } else {
      postMessage({ type: 'ready-for-input' });
    }
  } else if (msg.type === 'humanMove') {
    applyMoveFn(msg.move);
    const move = getBestMoveFn(msg.movetimeMs);
    postMessage({ type: 'engineMove', move });
  }
};
