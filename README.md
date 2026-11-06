# Legal chess

Play chess against a Prism app that never accepts or plays an illegal move.

**Play it:** https://humuhumu33.github.io/prism-legal-chess/

The page loads one file, `app.holo`, checks its fingerprint in your browser,
and sends every move to it. The board draws what the app answers and judges
nothing itself, so the opponent you play is exactly the program the proof is
about.

## What is guaranteed

| ID | Claim | Evidence |
| --- | --- | --- |
| `LC-01` | The app plays a reply only when the legality gate returns `Legal` for that move. | `gate_plays_only_legal` and `reply_is_legal`, checked by the Lean kernel |
| `LC-02` | The app accepts your move only when the legality gate returns `Legal` for it. | `gate_accepts_only_legal` and `admit_is_legal`, checked by the Lean kernel |
| `LC-03` | The legal moves the gate checks against reproduce the published perft counts of five reference positions to depth three. | Acceptance vectors replayed in the compiled guest, against the Chess Programming Wiki's counts |

The gate is `verdict pos move`: `Legal` exactly when `isLegalMove pos move`,
the rules of movement for the piece plus the rule that your own king is not
left in check. `LC-01` and `LC-02` are proofs. `LC-03` is a measurement:
it shows the move generator agrees with the rules of chess on positions built
to exercise castling, en passant, promotion, pins and checks, but it does not
prove agreement on every position.

Not detected: draws by repetition, the fifty-move rule, and insufficient
material, because a request carries no game history. The opponent looks two
moves ahead and counts material, so it is weak.

## The request

A position is 70 characters: the 64 squares from a1 to h8 (`.` for empty,
`PNBRQK` for White, `pnbrqk` for Black), the side to move (`w` or `b`), the
castling rights (`KQkq`, `-` for a lost right), and the en passant file (`a`
to `h`, or `-`).

| Request | Answer |
| --- | --- |
| position | the app moves: `<position> <its move> <status>` |
| position, a space, a move such as `e2e4` or `e7e8q` | your move, then the app's reply: `<position> <its move or -> <status>`, or `illegal move` |
| position, then `?` | the perft counts at depths one, two and three |
| anything else | `invalid request` |

The status is `play`, `check`, `checkmate` or `stalemate`, for the side to
move in the answered position.

## Build and verify

Everything runs in the SDK image `prismpm.lock` pins.

```sh
just vv                                         # the whole gate
just app                                        # the model, its proofs and the holo
npx prism-code inspect app/.prism/build/*/*.holo
npx prism-code vectors app/.prism/build/*/*.holo
```

The model is `app/src/Chess.lex.tex`. The claims are registered in
`model/ids.toml`, specified in `features/suites/chess.feature` and pinned by
`crates/conformance/tests/chess.rs`. `TEMPLATE-VERIFICATION.md` records each
gate's planted defect.

Built from [UOR-Foundation/template](https://github.com/UOR-Foundation/template).
Licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).
