Feature: chess

  The chess application in app/: given a position and, optionally, a move, it
  checks the move against the legal moves of the position, plays it, and
  answers with its own reply. It never accepts or plays a move that fails the
  legality gate, and its move generation is measured against published perft
  counts.

  @LC-01 @build
  Scenario: The app plays a reply only when the legality gate accepts that move
    Given the chess model in app/src/Chess.lex.tex
    When the Lean kernel checks gate_plays_only_legal and reply_is_legal during prismpm verify
    Then a reply is played only when the verdict of the engine's candidate is Legal
    And the reply the application returns is the one gate decides from that verdict

  @LC-02 @build
  Scenario: The app accepts a move only when the legality gate accepts it
    Given the chess model in app/src/Chess.lex.tex
    When the Lean kernel checks gate_accepts_only_legal and admit_is_legal during prismpm verify
    Then a move is accepted only when its verdict is Legal
    And every move the application plays for the visitor passes through admitMove

  @LC-03 @build
  Scenario: Legal move generation reproduces the published perft counts of five reference positions to depth three
    Given the five reference positions of the Chess Programming Wiki perft results
    When prismpm verify replays their count requests in the compiled guest
    Then each answers the published number of leaf positions at depths one, two and three
    And the counts are sums of isLegalMove, the predicate the legality gate checks against
