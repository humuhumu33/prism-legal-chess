// The board: a view over the holo, not a second chess engine. Every move the
// visitor makes is sent to the app as a request; the app answers with the
// position after its reply, or with "illegal move". The page draws what the
// app answers and never judges a move itself, so what you play against is
// exactly what the holo's proof is about.

const START = "RNBQKBNRPPPPPPPP" + ".".repeat(32) + "pppppppprnbqkbnr" + "wKQkq-";
// One solid glyph per kind; the side is drawn by colour, so both sides read
// the same in either theme.
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
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
  const cells = [];
  // `pos` is always a position the app answered; `shown` is what is drawn,
  // which differs only while the app is thinking about the visitor's move.
  let game = { pos: START, shown: START, human: "w", selected: null, last: [], busy: false, over: false };

  // One composite widget, as a board is: a grid of 64 cells with one tab
  // stop, arrow keys between cells, Enter or Space to pick and to move.
  let focus = 0;
  for (let r = 0; r < 8; r++) {
    const row = document.createElement("div");
    row.setAttribute("role", "row");
    row.className = "rank";
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.setAttribute("role", "gridcell");
      cell.className = "sq";
      cell.tabIndex = cells.length === 0 ? 0 : -1;
      const index = cells.length;
      cell.addEventListener("click", () => { moveFocus(index, false); onSquare(Number(cell.dataset.sq)); });
      row.append(cell);
      cells.push(cell);
    }
    board.append(row);
  }

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
    }
  });

  function draw() {
    const flip = game.human === "b";
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8);
      const col = i % 8;
      const sq = flip ? row * 8 + (7 - col) : (7 - row) * 8 + col;
      const piece = game.shown[sq];
      const cell = cells[i];
      cell.dataset.sq = String(sq);
      cell.dataset.glyph = piece === "." ? "" : GLYPH[piece.toLowerCase()] + "︎";
      cell.dataset.side = piece === "." ? "" : isWhite(piece) ? "w" : "b";
      cell.setAttribute("aria-label", `${squareName(sq)}, ${describe(piece)}`);
      cell.setAttribute("aria-selected", game.selected === sq ? "true" : "false");
      cell.classList.toggle("dark", (Math.floor(sq / 8) + (sq % 8)) % 2 === 0);
      cell.classList.toggle("last", game.last.includes(sq));
    }
  }

  function say(text, tone) {
    status.textContent = text;
    status.className = `chip chip-${tone}`;
  }

  function note(line) {
    const item = document.createElement("li");
    item.textContent = line;
    log.prepend(item);
  }

  // The app answers "<position> <its reply, or -> <status of that position>".
  function settle(response, mine) {
    const [reply, verdict] = response.slice(71).split(" ");
    const appMoved = reply !== "-";
    game.pos = game.shown = response.slice(0, 70);
    game.last = appMoved ? touched(reply) : touched(mine);
    note([mine && `you ${mine}`, appMoved && `app ${reply}`].filter(Boolean).join(", "));
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

  async function send(request, mine) {
    game.busy = true;
    board.setAttribute("aria-busy", "true");
    say("The app is thinking.", "wait");
    draw();
    // Let the browser paint the visitor's move before the guest runs.
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      wire.textContent = `→ ${request}`;
      const response = decoder.decode(await app.dispatch(encoder.encode(request)));
      wire.textContent = `→ ${request}\n← ${response}`;
      if (response === "illegal move") {
        game.shown = game.pos;
        say(`${mine} is not a legal move here.`, "bad");
      } else if (response === "invalid request") {
        game.shown = game.pos;
        say("The app refused the request.", "bad");
      } else {
        settle(response, mine);
      }
    } catch (error) {
      game.shown = game.pos;
      say(`Dispatch failed: ${error?.code ?? error?.message ?? error}`, "bad");
    } finally {
      game.busy = false;
      game.selected = null;
      board.removeAttribute("aria-busy");
      draw();
    }
  }

  function onSquare(sq) {
    if (game.busy || game.over) return;
    const piece = game.pos[sq];
    const own = piece !== "." && isWhite(piece) === (game.human === "w");
    if (own || game.selected === null) {
      game.selected = own && game.selected !== sq ? sq : null;
      draw();
      return;
    }
    const from = game.selected;
    const moving = game.pos[from];
    const promotes = moving.toLowerCase() === "p" && Math.floor(sq / 8) === (game.human === "w" ? 7 : 0);
    const uci = squareName(from) + squareName(sq) + (promotes ? promotion.value : "");
    const placed = promotes ? (game.human === "w" ? promotion.value.toUpperCase() : promotion.value) : moving;
    const lifted = game.pos.slice(0, from) + "." + game.pos.slice(from + 1);
    game.shown = lifted.slice(0, sq) + placed + lifted.slice(sq + 1);
    game.selected = null;
    game.last = [from, sq];
    send(`${game.pos} ${uci}`, uci);
  }

  function newGame(side) {
    game = { pos: START, shown: START, human: side, selected: null, last: [], busy: false, over: false };
    log.replaceChildren();
    wire.textContent = "";
    draw();
    if (side === "b") send(START, null);
    else say("Your move. You play White.", "good");
  }

  board.removeAttribute("aria-busy");
  $("new-white").addEventListener("click", () => newGame("w"));
  $("new-black").addEventListener("click", () => newGame("b"));
  newGame("w");
}
