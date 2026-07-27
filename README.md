# LeagueSol

A League of Legends match analysis toolkit for Windows, built on the LCU API.

Match history and cross-region lookup, premade detection, teammate and opponent analysis during
champion select, and item/rune recommendations — plus the feature this project exists for:

**Draft recommendation.** Given who has already been picked on both teams, which champion should
*you* pick? Not a tier list, and not a context-free counter table: a ranking that accounts for how a
champion pairs with your bot lane or jungler, how it fares into each opponent, and — unusually —
how much *you* have actually played it.

> **Status: in development.** The recommendation engine and its data layer are implemented and
> tested; the champion-select integration and the UI are not finished yet.

---

## Why another one

Existing draft tools are quite good and share two specific weaknesses.

**They present context-free pairwise numbers.** "Champion A beats Champion B 53%" is confounded by
who else was in the game, by the two champions' different player-base skill distributions, and by
pick order — a champion picked last into a known matchup shows an inflated win rate that is not
caused by the matchup. Worse, a duo win rate mostly reflects whichever champion is individually
strong this patch. LeagueSol works with *residuals* — how much a pairing over-performs what the two
champions would achieve with no interaction at all — so a strong champion does not appear to
synergise with the entire roster.

**They recommend champions you cannot play.** Both DraftGap and LoLDraftAI state outright that they
do not model player skill or champion mastery. The gap between the best published pairwise model and
the best published neural model is about one percentage point of accuracy; the gap between "the
optimal jungler" and "the optimal jungler *you have played more than four times*" is considerably
larger. The client already knows which champions you own and how often you have played them, so this
costs nothing but is left on the table everywhere.

Sample sizes make this harder than it looks. With ~170 champions there are roughly 14,000 ordered
champion pairs per role pairing, and pinning one cell's win rate to within 2% takes about 2,400
games. Almost no cell has that. Reading raw pair win rates does not produce a weak recommender, it
produces a noise generator — the most extreme-looking pairs are simply the ones with the fewest
games. Every pair statistic here is therefore shrunk toward its no-interaction baseline, by an
amount estimated from the data rather than hand-tuned, and every recommendation reports the sample
size behind each of its terms.

---

## Approach

No model is trained. The whole thing is arithmetic on a log-odds scale, where independent effects
add:

```
score(champion) =  base rating in role
                +  Σ  synergy residual with each drafted ally
                +  Σ  matchup residual against each drafted opponent
                +  your own proficiency adjustment
```

Every recommendation decomposes into exactly those terms, each labelled with the champion it came
from and the number of games behind it. "Kindred, +18" is not actionable; "+11 base, +9 with your
Lulu on 240 games, −7 into their Ahri" is something you can disagree with.

Deliberately out of scope for now: neural draft models, lookahead search over the remaining picks,
and team-composition identity (engage/poke/scaling, damage-type balance). These are real
improvements, but published results put the ceiling for champions-only draft prediction at about
57%, with existing tools already at ~55%.

---

## Data sources

| Data | Source |
|---|---|
| Champion win rates, lane counters | [op.gg champion API](https://op.gg) |
| Ally duo synergy | [op.gg MCP endpoint](https://github.com/opgginc/opgg-mcp) |
| Champion metadata and assets | Riot Data Dragon / Community Dragon |

Champion statistics are provided by **OP.GG**. Note that op.gg has no China region — on Tencent
servers the statistics shown are from other regions, and the UI labels them as such. Matchup and
synergy *differences* transfer between regions because they are driven by champion kits, which are
identical on a given patch; absolute win rates, pick rates and tier lists do not transfer and are
not shown in that situation.

---

## Scope and conduct

LeagueSol talks to the League client over its local API, and does nothing else. Specifically it does
**not** read game memory, inject into the game process, intercept network traffic, simulate input
into the running game, or reveal information the client deliberately hides. It contains no
advertising.

This is not a guarantee of anything. Third-party client tools are unsupported by Riot, and using one
is at your own risk.

---

## Development

```bash
yarn install
yarn test           # unit tests, plus live checks against op.gg and Data Dragon
yarn dev            # Electron + a running League client; Windows only
yarn build:win
```

The draft engine (`src/shared/draft-engine`) has no I/O, network or Electron dependencies, so it can
be developed and tested on any platform. That is deliberate: the League client is Windows-only and
refuses to run under virtualisation, so anything coupled to it can only be exercised by queueing up
a real game.

Set `LEAGUESOL_LIVE_TESTS=0` to skip the tests that hit the network. If you are behind a proxy, set
`https_proxy` — Node's `fetch` does not pick it up on its own, so the test setup wires it in.

---

## Licence

MIT. LeagueSol is derived from [League Akari](https://github.com/LeagueAkari/LeagueAkari) by
Hanxven, also MIT; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

LeagueSol isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
anyone officially involved in producing or managing Riot Games properties.
