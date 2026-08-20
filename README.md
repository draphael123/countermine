# THE UNSIGNED

A tactics roguelike. The war ended in a day; six generals never signed. Muster a captain, cross the Greenmarch — three captains, then the general — and raise your company from the prisoners in their cages.
fortress eleven years ago and neither came back out. You take a Serjeant and one
volunteer down after them, and recruit whoever is still standing.

**Play:** https://countermine.vercel.app

## The shape of it

- **Square-grid tactics.** Move up to your movement, then take one action:
  attack, or one of your class's two abilities on cooldown. No hit chance —
  every attack lands, damage varies, and the exact range is shown before you
  commit.
- **Flanking.** +3 damage when an ally stands on the tile directly opposite you
  across the target. It is the main reason to think about position.
- **Recruiting.** After every fight, three survivors offer to come along. Four is
  all the rations stretch to, so taking a fifth means leaving someone in the dark.
- **Permadeath.** Nobody comes back. Encounters scale to how many soldiers you
  have, so losing one makes the next fight harder to win rather than impossible.
- **Three floors**, a branching node map per floor, a boss at the bottom of each.
- **Relics** are party-wide and carried five at a time, Hades-style. **Tallies**
  bank on death and unlock new classes and relics into the pool for future runs —
  options, never raw stats.

## Classes

| | Role | Notes |
|---|---|---|
| Serjeant | Line officer | Always comes down. Rally, Hold the Line. |
| Pavisier | Shield | 3 armour, plants a barricade, Shield Wall. |
| Crossbowman | Shot | Hits hardest at range, but every shot costs a reload action. |
| Surgeon | Wounds | Three stitches a battle and no more. |
| Sapper | Powder | Timed charges that damage both sides and open walls. |
| Billman | Reach | Range 2, hooks foes out of position, sweeps a lane. |
| Cutthroat | Knife | Fast, fragile, doubled flanking, bleeds. |
| Flagellant | Faith | Buys allies power with its own blood; takes their wounds. |

The last four start locked and are bought on the Muster Roll.

## Enemies

Starveling, Trencher, Arbalest, Ironhusk, Cellar Hound, Bellman, Sump-Drowned,
plus three bosses. Anything with a wind-up marks the exact tiles it will hit
**next** turn, in a distinct hue from the ordinary threat overlay — moving out of
the marked tiles is always the right answer, and the game never hides which ones
they are.

## Running it locally

```bash
node server.js
```

Then open http://localhost:5814. The dev server sends `no-store` on purpose: ES
modules cached by the browser combine a fresh config with a stale module and fail
silently.

## Debug and balance harness

Everything is on `window.CM` in the console.

```js
CM.sim(25)                                  // 25 battles per floor/kind/party-size cell
CM.sim(25, { sizes: [4], relics: ['rations','scraps','wedge'] })
CM.simOne({ seed: 42, floorIdx: 2, kind: 'boss', party: [...] })
CM.newRun(1234)                             // seeded run
CM.wipeMeta()                               // clear unlocks and tallies
CM.dbg.click(x, y) / .select() / .endTurn() / .node(i) / .forceWin() / .finishBattle()
```

`sim()` reports `SUSPECT_noContact` and `timeouts` per cell. A non-zero
`noContact` means a battle resolved without one side ever dealing damage — the
result is meaningless, not a balance signal.

The sim bot is greedy and only uses damage abilities, so it never plants a
pavise, rallies, or uses terrain. Its win rates are a **floor** on what a person
achieves, not a prediction.

## Status

Vertical slice. Systems verified end to end; **feel is unvalidated** — no human
has played it yet.
