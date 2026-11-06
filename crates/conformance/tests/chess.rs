//! The `chess` suite: one test per scenario in `features/suites/chess.feature`.
//!
//! The proofs are checked by the Lean kernel and the acceptance vectors are
//! replayed in the compiled guest when `just vv` runs `prismpm verify` on
//! `app/`. What these tests hold fixed is what those checks are about: the
//! exact theorem statements, that the application's answers are routed
//! through the functions the theorems prove, and that the perft vectors carry
//! the published counts. A weakened statement, a reply decided some other way,
//! or a count copied from the model's own output would still verify, and would
//! no longer be the claim the ID makes.

use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/conformance is two below the root")
        .to_path_buf()
}

fn model() -> String {
    std::fs::read_to_string(root().join("app/src/Chess.lex.tex")).expect("the chess model")
}

/// The text of the top-level declaration named `name`, in either layout
/// `lexlean fmt` writes: one line, or one member to a line up to `}`.
fn declaration<'a>(model: &'a str, name: &str) -> &'a str {
    if let Some(start) = model.find(&format!("\n  name: {name},\n")) {
        let end = model[start..]
            .find("\n}\n")
            .unwrap_or_else(|| panic!("{name} is not closed"));
        return &model[start..start + end];
    }
    let start = model
        .find(&format!("{{name: {name}, "))
        .unwrap_or_else(|| panic!("{name} is not declared"));
    let end = model[start..].find('\n').expect("a line end");
    &model[start..start + end]
}

fn has(model: &str, name: &str, text: &str) {
    let found = declaration(model, name);
    assert!(
        found.contains(text),
        "{name} must contain `{text}`:\n{found}"
    );
}

/// The verdict is `isLegalMove`, the predicate LC-03's counts are built from.
fn verdict_is_membership(model: &str) {
    has(
        model,
        "verdict",
        "(if (isLegalMove pos move) then (ctor Verdict.Legal) else (ctor Verdict.Illegal))",
    );
}

/// `LC-01`: The app plays a reply only when the legality gate accepts that move
#[test]
fn chess_lc_01() {
    let model = model();
    verdict_is_membership(&model);
    has(
        &model,
        "gate",
        "| Verdict.Legal => (ctor Reply.Played choice)",
    );
    has(&model, "gate", "| Verdict.Illegal => (ctor Reply.Passed))");
    has(
        &model,
        "playsOnlyLegal",
        "(match answer | Reply.Played played => (isLegal check) | Reply.Passed => true)",
    );
    has(
        &model,
        "isLegal",
        "(match value | Verdict.Legal => true | Verdict.Illegal => false)",
    );
    has(
        &model,
        "gate_plays_only_legal",
        "statement: ((playsOnlyLegal check (gate choice check)) = true),",
    );
    has(
        &model,
        "gate_plays_only_legal",
        "parameters: [choice : Move, check : Verdict],",
    );
    assert!(
        !declaration(&model, "gate_plays_only_legal").contains("axioms:"),
        "the gate's theorem rests on no axiom"
    );
    // The reply is the gate applied to the engine's candidate and that same
    // candidate's verdict, so the theorem covers every reply the app makes.
    has(
        &model,
        "reply",
        "body: (gate (candidate pos) (verdict pos (candidate pos)))",
    );
    has(
        &model,
        "reply_is_legal",
        "statement: ((playsOnlyLegal (verdict pos (candidate pos)) (reply pos)) = true),",
    );
    has(&model, "reply_is_legal", "theorem: gate_plays_only_legal");
    has(&model, "engineTurn", "body: (match (reply pos)");
    has(
        &model,
        "engineTurn",
        "| Reply.Played played => (report (playMove pos played) (encodeMove played))",
    );
    has(&model, "dispatch", "(if (size =? 70) then (engineTurn pos)");
    has(
        &model,
        "userTurn",
        "| Outcome.Accepted after => (if ((countLegal after) =? 0) then (report after 0x2d) else (engineTurn after))",
    );
}

/// `LC-02`: The app accepts a move only when the legality gate accepts it
#[test]
fn chess_lc_02() {
    let model = model();
    verdict_is_membership(&model);
    has(
        &model,
        "admitGate",
        "| Verdict.Legal => (ctor Outcome.Accepted (playMove pos move))",
    );
    has(
        &model,
        "admitGate",
        "| Verdict.Illegal => (ctor Outcome.Rejected))",
    );
    has(
        &model,
        "acceptsOnlyLegal",
        "(match outcome | Outcome.Accepted after => (isLegal check) | Outcome.Rejected => true)",
    );
    has(
        &model,
        "gate_accepts_only_legal",
        "statement: ((acceptsOnlyLegal check (admitGate pos move check)) = true),",
    );
    has(
        &model,
        "admitMove",
        "body: (admitGate pos move (verdict pos move))",
    );
    has(
        &model,
        "admit_is_legal",
        "statement: ((acceptsOnlyLegal (verdict pos move) (admitMove pos move)) = true),",
    );
    has(&model, "admit_is_legal", "theorem: gate_accepts_only_legal");
    has(&model, "userTurn", "body: (match (admitMove pos move)");
    has(
        &model,
        "userTurn",
        "| Outcome.Rejected => (prim utf8_encode \"illegal move\" : Bytes)",
    );
    has(
        &model,
        "dispatch",
        "| MoveRead.Read move => (userTurn pos move)",
    );
    // A visitor's move is played only through the gate.
    for name in ["dispatch", "userTurn"] {
        assert!(
            !declaration(&model, name).contains("playMove"),
            "{name} must not play a move around the gate"
        );
    }
}

/// The request the model reads for a position: 64 cells from a1 to h8, the
/// side to move, the four castling rights, the en passant file.
fn request(fen: &str) -> String {
    let fields: Vec<&str> = fen.split(' ').collect();
    let mut cells = String::new();
    for row in fields[0].split('/').rev() {
        for c in row.chars() {
            match c.to_digit(10) {
                Some(n) => cells.push_str(&".".repeat(n as usize)),
                None => cells.push(c),
            }
        }
    }
    assert_eq!(cells.len(), 64, "{fen}");
    let rights: String = "KQkq"
        .chars()
        .map(|r| if fields[2].contains(r) { r } else { '-' })
        .collect();
    let mark = fields[3].chars().next().expect("an en passant field");
    format!("{cells}{}{rights}{mark}?", fields[1])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `LC-03`: Legal move generation reproduces the published perft counts of five reference positions to depth three
#[test]
fn chess_lc_03() {
    let model = model();
    // Counts as published by the Chess Programming Wiki, "Perft Results"
    // (model/authorities.toml, CPW-PERFT), not as the model computes them.
    let published = [
        (
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
            "20 400 8902",
        ),
        (
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -",
            "48 2039 97862",
        ),
        ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -", "14 191 2812"),
        (
            "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -",
            "6 264 9467",
        ),
        (
            "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -",
            "44 1486 62379",
        ),
    ];
    let application = declaration(&model, "application");
    for (fen, counts) in published {
        let vector = format!(
            "{{request := 0x{}, response := 0x{}}}",
            hex(request(fen).as_bytes()),
            hex(counts.as_bytes())
        );
        assert!(
            application.contains(&vector),
            "the acceptance vectors must carry the published perft counts {counts} for {fen}"
        );
    }
    has(
        &model,
        "dispatch",
        "(if ((size =? 71) && ((codeAt value 70) =? 63)) then (perftText pos)",
    );
    has(&model, "perftText", "(digitsOf (countLegal pos) 20)");
    has(&model, "perftText", "(digitsOf (countTwo pos) 20)");
    has(&model, "perftText", "(digitsOf (countThree pos) 20)");
    has(
        &model,
        "valueLegal",
        "(if (isLegalMove pos move) then 1 else 0)",
    );
    has(
        &model,
        "valueTwo",
        "(if (isLegalMove pos move) then (countLegal (playMove pos move)) else 0)",
    );
    has(
        &model,
        "valueThree",
        "(if (isLegalMove pos move) then (countTwo (playMove pos move)) else 0)",
    );
    // Every move a pair of squares stands for is counted: four when a pawn
    // promotes, one otherwise, so no legal move escapes the counts.
    for level in ["Legal", "Two", "Three"] {
        has(
            &model,
            &format!("pair{level}"),
            &format!("(if (promotes pos start finish) then ((value{level} pos (mkMove start finish 5)) + ((value{level} pos (mkMove start finish 4)) + ((value{level} pos (mkMove start finish 3)) + (value{level} pos (mkMove start finish 2))))) else (value{level} pos (mkMove start finish 0)))"),
        );
        has(
            &model,
            &format!("origins{level}"),
            &format!("(targets{level} pos start 0 64)"),
        );
    }
}
