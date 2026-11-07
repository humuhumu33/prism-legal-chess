// The board: a view over the holo, not a second chess engine. Every move the
// visitor makes is sent to the app as a request; the app answers with the
// position after its reply, or with "illegal move". The page draws what the
// app answers and never judges a move itself, so what you play against is
// exactly what the holo's proof is about.
//
// site/card.html already holds the 64 squares in the start position, so the
// board is on screen before the app loads; this module only wires them up.

const START = "RNBQKBNRPPPPPPPP" + ".".repeat(32) + "pppppppprnbqkbnr" + "wKQkq-";
const NAME = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const squareName = (sq) => "abcdefgh"[sq % 8] + (Math.floor(sq / 8) + 1);
const squareOf = (name) => (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97);
const isWhite = (c) => c >= "A" && c <= "Z";
const describe = (c) => (c === "." ? "empty" : `${isWhite(c) ? "white" : "black"} ${NAME[c.toLowerCase()]}`);
const touched = (uci) => (uci && uci.length >= 4 ? [squareOf(uci.slice(0, 2)), squareOf(uci.slice(2, 4))] : []);

export function startBoard(app, $) {
  const board = $("board");
  const status = $("game-status");
  const log = $("game-log");
  const wire = $("game-wire");
  const promotion = $("promotion");
  const undo = $("undo");
  const cells = [...board.querySelectorAll(".sq")];
  // `pos` is always a position the app answered; `shown` is what is drawn,
  // which differs only while the app is thinking about the visitor's move.
  // `history` holds the positions before each of the visitor's moves, for
  // taking one back; the page keeps it, the app is never asked to.
  let game;

  // One composite widget, as a board is: a grid of 64 cells with one tab
  // stop, arrow keys between cells, Enter or Space to pick and to move.
  let focus = 0;
  function moveFocus(index, take) {
    cells[focus].tabIndex = -1;
    focus = index;
    cells[focus].tabIndex = 0;
    if (take) cells[focus].focus();
  }

  board.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
    if (step !== undefined) {
      const next = focus + step;
      const sameRow = Math.abs(step) !== 1 || Math.floor(next / 8) === Math.floor(focus / 8);
      if (next >= 0 && next < 64 && sameRow) moveFocus(next, true);
      event.preventDefault();
    } else if (event.key === "Enter" || event.key === " ") {
      onSquare(Number(cells[focus].dataset.sq));
      event.preventDefault();
    } else if (event.key === "Escape" && game.selected !== null) {
      game.selected = null;
      draw();
    }
  });

  const mine = (piece) => piece !== "." && isWhite(piece) === (game.human === "w");
  const playable = () => !game.busy && !game.over;

  function draw() {
    const flip = game.human === "b";
    const toMove = game.shown[64];
    const checked = game.inCheck ? (toMove === "w" ? "K" : "k") : null;
    board.classList.toggle("picking", game.selected !== null);
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8);
      const col = i % 8;
      const sq = flip ? row * 8 + (7 - col) : (7 - row) * 8 + col;
      const piece = game.shown[sq];
      const cell = cells[i];
      cell.dataset.sq = String(sq);
      cell.dataset.side = piece === "." ? "" : isWhite(piece) ? "w" : "b";
      cell.querySelector("use").setAttribute("href", piece === "." ? "" : `#lc-${piece.toLowerCase()}`);
      // The coordinates follow the board's edges, which change when it flips.
      if (col === 0) cell.dataset.rl = String(Math.floor(sq / 8) + 1);
      else delete cell.dataset.rl;
      if (row === 7) cell.dataset.fl = "abcdefgh"[sq % 8];
      else delete cell.dataset.fl;
      cell.setAttribute("aria-label", `${squareName(sq)}, ${describe(piece)}`);
      cell.setAttribute("aria-selected", game.selected === sq ? "true" : "false");
      cell.classList.toggle("dark", (Math.floor(sq / 8) + (sq % 8)) % 2 === 0);
      cell.classList.toggle("last", game.last.includes(sq));
      cell.classList.toggle("own", playable() && game.shown === game.pos && mine(piece));
      cell.classList.toggle("check", piece === checked);
    }
    undo.disabled = game.busy || game.history.length === 0;
  }

  function say(text, tone) {
    status.textContent = text;
    status.title = text;
    status.className = `chip chip-${tone}`;
  }

  function note(line) {
    const item = document.createElement("li");
    item.textContent = line;
    log.prepend(item);
  }

  // The app answers "<position> <its reply, or -> <status of that position>".
  function settle(response, played) {
    const [reply, verdict] = response.slice(71).split(" ");
    const appMoved = reply !== "-";
    game.pos = game.shown = response.slice(0, 70);
    game.last = appMoved ? touched(reply) : touched(played);
    game.inCheck = verdict === "check" || verdict === "checkmate";
    note([played && `you ${played}`, appMoved && `app ${reply}`].filter(Boolean).join(", "));
    if (verdict === "checkmate") {
      game.over = true;
      say(appMoved ? "Checkmate. The app wins." : "Checkmate. You win.", appMoved ? "bad" : "good");
    } else if (verdict === "stalemate") {
      game.over = true;
      say("Stalemate. A draw.", "warn");
    } else if (verdict === "check") {
      say("Check. Your move.", "warn");
    } else {
      say("Your move.", "good");
    }
  }

  async function send(request, played) {
    game.busy = true;
    board.setAttribute("aria-busy", "true");
    say("The app is thinking…", "wait");
    draw();
    // Let the browser paint the visitor's move before the guest runs.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = game.history.length;
    try {
      wire.textContent = `→ ${request}`;
      const response = decoder.decode(await app.dispatch(encoder.encode(request)));
      wire.textContent = `→ ${request}\n← ${response}`;
      if (response === "illegal move") {
        game.shown = game.pos;
        game.last = game.lastAnswered;
        if (played) game.history.length = before - 1;
        say(`${played} is not a legal move here.`, "bad");
      } else if (response === "invalid request") {
        game.shown = game.pos;
        game.last = game.lastAnswered;
        if (played) game.history.length = before - 1;
        say("The app refused the request.", "bad");
      } else {
        settle(response, played);
        game.lastAnswered = game.last;
      }
    } catch (error) {
      game.shown = game.pos;
      game.last = game.lastAnswered;
      if (played) game.history.length = before - 1;
      say(`Dispatch failed: ${error?.code ?? error?.message ?? error}`, "bad");
    } finally {
      game.busy = false;
      game.selected = null;
      board.removeAttribute("aria-busy");
      draw();
    }
  }

  function play(from, sq) {
    const moving = game.pos[from];
    const promotes = moving.toLowerCase() === "p" && Math.floor(sq / 8) === (game.human === "w" ? 7 : 0);
    const uci = squareName(from) + squareName(sq) + (promotes ? promotion.value : "");
    const placed = promotes ? (game.human === "w" ? promotion.value.toUpperCase() : promotion.value) : moving;
    const lifted = game.pos.slice(0, from) + "." + game.pos.slice(from + 1);
    game.history.push({ pos: game.pos, last: game.lastAnswered, inCheck: game.inCheck });
    game.shown = lifted.slice(0, sq) + placed + lifted.slice(sq + 1);
    game.selected = null;
    game.last = [from, sq];
    game.inCheck = false;
    send(`${game.pos} ${uci}`, uci);
  }

  function onSquare(sq) {
    if (!playable()) return;
    const piece = game.pos[sq];
    if (mine(piece) || game.selected === null) {
      game.selected = mine(piece) && game.selected !== sq ? sq : null;
      draw();
      return;
    }
    play(game.selected, sq);
  }

  // Drag and drop, on top of click-to-move: press on one of your pieces,
  // move past a few pixels, and release over the target square.
  let drag = null;
  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest?.(".sq");

  board.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !playable()) return;
    const cell = event.target.closest(".sq");
    if (!cell || !cell.classList.contains("own")) return;
    drag = { cell, from: Number(cell.dataset.sq), x: event.clientX, y: event.clientY, ghost: null, wasSelected: game.selected === Number(cell.dataset.sq) };
    cell.setPointerCapture?.(event.pointerId);
  });

  board.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
      const size = drag.cell.getBoundingClientRect().width;
      const ghost = drag.cell.querySelector("svg").cloneNode(true);
      ghost.setAttribute("class", `drag-ghost ${drag.cell.dataset.side}`);
      ghost.setAttribute("width", String(size));
      ghost.setAttribute("height", String(size));
      document.body.append(ghost);
      document.body.classList.add("dragging");
      drag.ghost = ghost;
      drag.size = size;
      drag.cell.classList.add("lifted");
      game.selected = drag.from;
      draw();
    }
    drag.ghost.style.transform = `translate(${event.clientX - drag.size / 2}px, ${event.clientY - drag.size / 2}px)`;
  });

  function endDrag(event, cancelled) {
    if (!drag) return;
    const { ghost, from, cell, wasSelected } = drag;
    drag = null;
    if (!ghost) {
      // A plain click: let the click handler pick or drop.
      return;
    }
    ghost.remove();
    document.body.classList.remove("dragging");
    cell.classList.remove("lifted");
    // The click that may follow this release is the drop, not a second pick.
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    const target = cancelled ? null : cellAt(event.clientX, event.clientY);
    const to = target ? Number(target.dataset.sq) : null;
    if (to === null || to === from) {
      game.selected = to === from && !wasSelected ? from : null;
      draw();
      return;
    }
    if (mine(game.pos[to])) {
      game.selected = null;
      draw();
      return;
    }
    play(from, to);
  }
  board.addEventListener("pointerup", (event) => endDrag(event, false));
  board.addEventListener("pointercancel", (event) => endDrag(event, true));

  let suppressClick = false;
  board.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const cell = event.target.closest(".sq");
    if (!cell) return;
    moveFocus(cells.indexOf(cell), false);
    onSquare(Number(cell.dataset.sq));
  });

  undo.addEventListener("click", () => {
    if (game.busy || game.history.length === 0) return;
    const back = game.history.pop();
    game.pos = game.shown = back.pos;
    game.last = game.lastAnswered = back.last;
    game.inCheck = back.inCheck;
    game.over = false;
    game.selected = null;
    note("taken back");
    // The visitor playing Black whose first move is taken back is facing the
    // app's opening move again, which is the position the history kept.
    say(game.inCheck ? "Check. Your move." : "Your move.", game.inCheck ? "warn" : "good");
    draw();
  });

  function newGame(side) {
    game = { pos: START, shown: START, human: side, selected: null, last: [], lastAnswered: [], inCheck: false, busy: false, over: false, history: [] };
    log.replaceChildren();
    wire.textContent = "";
    draw();
    if (side === "b") send(START, null);
    else say("Your move, as White.", "good");
  }

  board.removeAttribute("aria-busy");
  board.classList.add("live");
  $("new-white").addEventListener("click", () => newGame("w"));
  $("new-black").addEventListener("click", () => newGame("b"));
  newGame("w");
}

// The frame's card hook: app.mjs calls this with the same verified instance
// the identity shows, or with null and the reason the app is not there. The
// board stays drawn either way; without an app it is dimmed and takes no moves.
export default function start({ app, reason, $, chip }) {
  if (!app) {
    const board = $("board");
    board.removeAttribute("aria-busy");
    board.classList.add("off");
    $("new-white").disabled = true;
    $("new-black").disabled = true;
    chip($("game-status"), reason === "no app" ? "The app failed to load" : `The app is ${reason}, so the board is off`, "bad");
    return;
  }
  startBoard(app, $);
}
