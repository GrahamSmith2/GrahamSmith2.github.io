import { Chess } from './vendor/chess.esm.js';

const chess = new Chess();
const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ALL_FILES = 'abcdefgh'.split('');

const MOVETIME_MS = 4000;

let playerColor = 'w';
let selectedSquare = null;
let legalTargets = [];
let lastMove = null;
let gameOver = false;
let gameOverText = '';
let engineThinking = false;
let uciMoves = [];

const engineWorker = new Worker('engine-worker.js');
let engineReady = false;
let pendingEngineResolve = null;

engineWorker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'ready') {
    engineReady = true;
    document.getElementById('loadStatus').classList.add('hidden');
    document.getElementById('colorButtons').classList.remove('hidden');
  } else if (msg.type === 'error') {
    document.getElementById('loadStatus').textContent = 'Failed to load engine: ' + msg.message;
  } else if (msg.type === 'engineMove' && pendingEngineResolve) {
    const resolve = pendingEngineResolve;
    pendingEngineResolve = null;
    resolve(msg.move || null);
  }
};

function waitForEngineMove() {
  return new Promise((resolve) => {
    pendingEngineResolve = resolve;
  });
}

const statusEl = document.getElementById('status');
const materialDiffEl = document.getElementById('materialDiff');
const moveListEl = document.getElementById('moveList');
const boardEl = document.getElementById('board');
const filesEl = document.getElementById('files');
const ranksEl = document.getElementById('ranks');

function squareOrder(orientation) {
  const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === 'w' ? ALL_FILES : [...ALL_FILES].reverse();
  const order = [];
  for (const r of ranks) {
    for (const f of files) order.push(f + r);
  }
  return order;
}

function findKing(color) {
  for (const f of ALL_FILES) {
    for (let r = 1; r <= 8; r++) {
      const sq = f + r;
      const p = chess.get(sq);
      if (p && p.type === 'k' && p.color === color) return sq;
    }
  }
  return null;
}

function pieceImg(color, type) {
  return `pieces/${color}${type.toUpperCase()}.svg`;
}

function render() {
  boardEl.innerHTML = '';
  const order = squareOrder(playerColor);

  let checkKingSquare = null;
  if (chess.inCheck()) checkKingSquare = findKing(chess.turn());

  for (const sq of order) {
    const fileIdx = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq[1], 10);
    const isLight = (fileIdx + rank) % 2 === 0;

    const sqEl = document.createElement('div');
    sqEl.className = 'square ' + (isLight ? 'light' : 'dark');

    if (selectedSquare === sq) sqEl.classList.add('selected');
    if (lastMove && (lastMove.from === sq || lastMove.to === sq)) sqEl.classList.add('last-move');
    if (checkKingSquare === sq) sqEl.classList.add('in-check');

    const piece = chess.get(sq);
    if (piece) {
      const img = document.createElement('img');
      img.className = 'piece';
      img.src = pieceImg(piece.color, piece.type);
      img.draggable = false;
      sqEl.appendChild(img);
    }

    if (legalTargets.some((m) => m.to === sq)) {
      const marker = document.createElement('div');
      marker.className = piece ? 'capture-ring' : 'move-dot';
      sqEl.appendChild(marker);
    }

    sqEl.addEventListener('click', () => onSquareClick(sq));
    boardEl.appendChild(sqEl);
  }

  filesEl.innerHTML = '';
  const filesOrder = playerColor === 'w' ? ALL_FILES : [...ALL_FILES].reverse();
  for (const f of filesOrder) {
    const s = document.createElement('span');
    s.textContent = f;
    filesEl.appendChild(s);
  }

  ranksEl.innerHTML = '';
  const ranksOrder = playerColor === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  for (const r of ranksOrder) {
    const s = document.createElement('span');
    s.textContent = r;
    ranksEl.appendChild(s);
  }
}

function updateStatus() {
  statusEl.className = 'status';
  if (gameOver) {
    statusEl.classList.add('over');
    statusEl.textContent = gameOverText;
    return;
  }
  if (engineThinking) {
    statusEl.classList.add('thinking');
    statusEl.textContent = 'Engine is thinking… (up to ' + (MOVETIME_MS / 1000) + 's)';
    return;
  }
  const turnText = chess.turn() === playerColor ? 'Your move' : "Engine's move";
  if (chess.inCheck()) {
    statusEl.classList.add('check');
    statusEl.textContent = turnText + ' — Check!';
  } else {
    statusEl.textContent = turnText;
  }
}

function checkGameOver() {
  if (chess.isCheckmate()) {
    gameOver = true;
    const winner = chess.turn() === 'w' ? 'Black' : 'White';
    gameOverText = `Checkmate — ${winner} wins!`;
  } else if (chess.isStalemate()) {
    gameOver = true;
    gameOverText = 'Draw by stalemate.';
  } else if (chess.isThreefoldRepetition()) {
    gameOver = true;
    gameOverText = 'Draw by threefold repetition.';
  } else if (chess.isInsufficientMaterial()) {
    gameOver = true;
    gameOverText = 'Draw by insufficient material.';
  } else if (chess.isDraw()) {
    gameOver = true;
    gameOverText = 'Draw (fifty-move rule).';
  } else {
    gameOver = false;
  }
}

function updateMoveList() {
  moveListEl.innerHTML = '';
  const history = chess.history();
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = i / 2 + 1 + '.';
    const white = document.createElement('span');
    white.className = 'mv';
    white.textContent = history[i] || '';
    const black = document.createElement('span');
    black.className = 'mv';
    black.textContent = history[i + 1] || '';
    li.appendChild(num);
    li.appendChild(white);
    li.appendChild(black);
    moveListEl.appendChild(li);
  }
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

function renderTray(elId, lostList) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  const order = { q: 0, r: 1, b: 2, n: 3, p: 4 };
  const sorted = [...lostList].sort((a, b) => order[a[1]] - order[b[1]]);
  for (const t of sorted) {
    const img = document.createElement('img');
    img.src = pieceImg(t[0], t[1]);
    el.appendChild(img);
  }
}

function updateMaterial() {
  const history = chess.history({ verbose: true });
  const lostByWhite = [];
  const lostByBlack = [];
  for (const m of history) {
    if (m.captured) {
      const victimColor = m.color === 'w' ? 'b' : 'w';
      const entry = victimColor + m.captured;
      if (victimColor === 'w') lostByWhite.push(entry);
      else lostByBlack.push(entry);
    }
  }

  const topLost = playerColor === 'w' ? lostByBlack : lostByWhite;
  const bottomLost = playerColor === 'w' ? lostByWhite : lostByBlack;
  renderTray('trayTop', topLost);
  renderTray('trayBottom', bottomLost);

  const valueOf = (t) => VALUES[t[1]];
  const whiteLostValue = lostByWhite.reduce((s, t) => s + valueOf(t), 0);
  const blackLostValue = lostByBlack.reduce((s, t) => s + valueOf(t), 0);
  const diff = blackLostValue - whiteLostValue;
  if (diff === 0) materialDiffEl.textContent = 'Material: even';
  else if (diff > 0) materialDiffEl.textContent = `Material: White +${diff}`;
  else materialDiffEl.textContent = `Material: Black +${-diff}`;
}

function showPromotionPicker(from, callback) {
  const overlay = document.getElementById('promoOverlay');
  const box = document.getElementById('promoBox');
  box.innerHTML = '';
  const color = chess.get(from).color;
  for (const c of ['q', 'r', 'b', 'n']) {
    const img = document.createElement('img');
    img.src = pieceImg(color, c);
    img.addEventListener('click', () => {
      overlay.classList.add('hidden');
      callback(c);
    });
    box.appendChild(img);
  }
  overlay.classList.remove('hidden');
}

function finalizeMove(from, to, promotion) {
  const moveObj = { from, to };
  if (promotion) moveObj.promotion = promotion;
  const result = chess.move(moveObj);
  if (!result) return;

  uciMoves.push(from + to + (promotion || ''));
  selectedSquare = null;
  legalTargets = [];
  lastMove = { from, to };
  render();
  updateMoveList();
  updateMaterial();
  checkGameOver();
  updateStatus();

  if (!gameOver) requestEngineMove();
}

function applyUciMove(uci) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  const moveObj = { from, to };
  if (promotion) moveObj.promotion = promotion;
  const result = chess.move(moveObj);
  if (result) {
    uciMoves.push(uci);
    lastMove = { from, to };
  }
}

async function requestEngineMove() {
  engineThinking = true;
  updateStatus();
  try {
    const lastUciMove = uciMoves[uciMoves.length - 1];
    engineWorker.postMessage({ type: 'humanMove', move: lastUciMove, movetimeMs: MOVETIME_MS });
    const move = await waitForEngineMove();
    if (move) applyUciMove(move);
  } catch (e) {
    console.error(e);
  }
  engineThinking = false;
  render();
  updateMoveList();
  updateMaterial();
  checkGameOver();
  updateStatus();
}

function onSquareClick(square) {
  if (gameOver || engineThinking || chess.turn() !== playerColor) return;

  if (selectedSquare) {
    if (selectedSquare === square) {
      selectedSquare = null;
      legalTargets = [];
      render();
      return;
    }
    const matching = legalTargets.filter((m) => m.to === square);
    if (matching.length > 1) {
      showPromotionPicker(selectedSquare, (promo) => finalizeMove(selectedSquare, square, promo));
      return;
    } else if (matching.length === 1) {
      finalizeMove(selectedSquare, square, matching[0].promotion);
      return;
    }
    const piece = chess.get(square);
    if (piece && piece.color === playerColor) {
      selectedSquare = square;
      legalTargets = chess.moves({ square, verbose: true });
    } else {
      selectedSquare = null;
      legalTargets = [];
    }
    render();
  } else {
    const piece = chess.get(square);
    if (piece && piece.color === playerColor) {
      selectedSquare = square;
      legalTargets = chess.moves({ square, verbose: true });
      render();
    }
  }
}

async function startNewGame(color) {
  chess.reset();
  uciMoves = [];
  playerColor = color;
  selectedSquare = null;
  legalTargets = [];
  lastMove = null;
  gameOver = false;

  document.getElementById('setup').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  render();
  updateMoveList();
  updateMaterial();
  statusEl.textContent = 'Starting game…';

  try {
    const needEngineMove = color === 'b';
    engineWorker.postMessage({ type: 'newGame', needEngineMove, movetimeMs: MOVETIME_MS });
    if (needEngineMove) {
      engineThinking = true;
      updateStatus();
      const move = await waitForEngineMove();
      engineThinking = false;
      if (move) {
        applyUciMove(move);
        render();
        updateMoveList();
        updateMaterial();
      }
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Engine error — try New Game again.';
    return;
  }
  updateStatus();
}

document.getElementById('playWhiteBtn').addEventListener('click', () => startNewGame('w'));
document.getElementById('playBlackBtn').addEventListener('click', () => startNewGame('b'));
document.getElementById('newGameBtn').addEventListener('click', () => {
  document.getElementById('game').classList.add('hidden');
  document.getElementById('setup').classList.remove('hidden');
});
