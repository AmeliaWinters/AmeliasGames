/**
 * The screen after somebody gets to a hundred: who won, how each seat played,
 * the two things worth writing down, and every round replayed.
 *
 * The review is the part of this game people actually came for -- a race you
 * lost is still twenty words you have now seen the meaning of -- so it is the
 * bulk of the screen rather than a footnote under the verdict.
 */
import {
  DEFAULT_LEVEL,
  MODE_LABEL,
  VOCAB_LANG_NAME,
  vocabStats,
} from "../../../shared/games/vocabDisplay.js";
import type { VocabLang, VocabState } from "../../../shared/games/vocabDisplay.js";

import { seconds } from "./copy.js";
import { Review, SeatStats } from "./parts.js";

export function VocabOver({
  state,
  seat,
  lang,
  nameFor,
}: {
  state: VocabState;
  seat: number | null;
  lang: VocabLang;
  nameFor: (index: number) => string;
}) {
  const stats = vocabStats(state);
  const rounds = state.round === null ? state.history : [...state.history, state.round];
  const ranked = [...stats.seats].sort((a, b) => b.points - a.points);
  return (
    <div className="board vr-board vr-end">
      <div className="vr-over" role="status">
        <p className="vr-verdict">
          {state.winner === null
            ? "Nobody got there. It's a tie."
            : state.winner === seat
              ? `You win, ${state.scores[state.winner]}-${Math.max(
                  ...state.scores.filter((_, i) => i !== state.winner),
                )}.`
              : `${nameFor(state.winner)} wins with ${state.scores[state.winner]}.`}
        </p>
      </div>

      {/*
        Sorted by points rather than by seat, which the live scoreline is
        not. At the end the question is who won and by how much; during a
        round it is where *you* are, and a table that reorders itself under
        the player's eye every time somebody scores is unreadable.
      */}
      <ul className="vr-stat-seats">
        {ranked.map((stat) => (
          <SeatStats
            key={stat.seat}
            stat={stat}
            name={nameFor(stat.seat)}
            level={state.levels[stat.seat] ?? DEFAULT_LEVEL}
          />
        ))}
      </ul>

      {stats.quickest && (
        <p className="vr-highlight">
          <strong>Quickest</strong>: {nameFor(stats.quickest.attempt.seat)} had{" "}
          <span lang={lang}>{stats.quickest.round.answer?.word}</span> in{" "}
          {seconds(stats.quickest.attempt.ms)}.
        </p>
      )}

      {/*
        The words nobody got, called out above the full list. This is the one
        thing on the screen that is worth writing down, and burying it among
        twenty rounds the table did know would waste it.
      */}
      {stats.missedByAll.length > 0 && (
        <p className="vr-highlight">
          <strong>Nobody knew</strong>{" "}
          {stats.missedByAll.map((round, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <span lang={lang}>{round.answer?.word}</span> ({round.clue})
            </span>
          ))}
          .
        </p>
      )}

      <h3 className="vr-review-head">
        All {rounds.length} {rounds.length === 1 ? "round" : "rounds"}:{" "}
        {VOCAB_LANG_NAME[lang]}, {MODE_LABEL[state.mode]}
      </h3>
      <ol className="vr-reviews">
        {rounds.map((round, i) => (
          <Review key={i} round={round} lang={lang} nameFor={nameFor} />
        ))}
      </ol>
    </div>
  );
}
