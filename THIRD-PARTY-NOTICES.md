# Third-Party Notices

LeagueSol incorporates and builds upon third-party open source software. The original copyright
notices and license terms are reproduced below, as required by their respective licenses.

---

## League Akari

- Project: https://github.com/LeagueAkari/LeagueAkari
- Author: Hanxven
- License: MIT
- Baseline: commit `42adbcb9df920053bedda10d8dab619f0a4a2c2e` (2026-07-27)

LeagueSol is derived from the League Akari codebase. The League Client (LCU) integration layer —
credential discovery, the WAMP WebSocket event bus, the SGP cross-region data source, the shard
architecture, and the OP.GG HTTP client — originates from that project and remains under its
copyright.

```
MIT License

Copyright (c) 2026 Hanxven

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Licensing history note

League Akari was MIT at inception (December 2023), relicensed to GPL-3.0 on 2024-11-08, and
relicensed back to MIT on 2026-02-13. LeagueSol is derived from the current MIT-licensed `main`
branch. Anyone intending to distribute LeagueSol under terms incompatible with GPL-3.0 should
independently audit the provenance of code contributed by third parties during the GPL-3.0 window.

---

## Data sources

### OP.GG

Champion statistics, lane matchup data, and duo synergy data are retrieved from OP.GG:

- `https://lol-api-champion.op.gg` — champion win rates, tier data, lane counters
- `https://mcp-api.op.gg/mcp` — duo synergy data, via the endpoint published at
  https://github.com/opgginc/opgg-mcp (MIT)

Data is © OP.GG and is displayed with attribution. LeagueSol is not affiliated with OP.GG.

### Riot Games

Champion, item, and rune metadata and images are retrieved from Data Dragon and Community Dragon.

LeagueSol isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
anyone officially involved in producing or managing Riot Games properties. Riot Games and all
associated properties are trademarks or registered trademarks of Riot Games, Inc.

---

## Node dependencies

Runtime and build dependencies are declared in `package.json`; their individual licenses are
recorded in `yarn.lock` and in each package's own distribution.
