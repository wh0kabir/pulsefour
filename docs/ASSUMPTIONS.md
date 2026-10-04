# Assumptions register

**Every row here is an invented simulation parameter, not a fact.** None of it is a
medical claim. The live values are in `src/config/assumptions.ts`, which is the single
source of truth — the `/about` page generates its table from that file, so it cannot
drift. This document explains *why* each number is what it is.

If you add an invented number anywhere in the codebase, it goes in
`src/config/assumptions.ts` and gets a row here. Never a magic number in code.

| Parameter | Starting value | Notes |
| --- | --- | --- |
| Effective ambulance speed by road class under congestion (km/h) | motorway/trunk 45, primary 35, secondary 28, tertiary 22, residential 18, other 12 | Conservative. Mumbai traffic is not free-flowing, so we deliberately do **not** use OSMnx's guessed free-flow speeds. |
| Scenario congestion multiplier | 1.0 default, 0.7 for a rain scenario | Applies to all speeds. |
| Severity weights (priority) | red 100, yellow 40, green 10 | Black is never allocated. |
| Deterioration limit before an adverse outcome (min) | red 45, yellow 90, green 240 | **Not a medical claim.** Research found no sound hard golden-hour threshold. The UI says "waited past limit", never "died". |
| Treatment time occupying a bed (min) | red 180, yellow 90, green 30 | |
| Supplies consumed on handover | red: 2 blood, 2 oxygen; yellow: 1 oxygen; green: none | |
| Hospital load penalty | 0 minutes up to 60% full, rising quadratically to 20 minutes at 100% | A cost that steers patients away from nearly-full hospitals. |
| Waiting factor | `1 + waitedMin / 30`, capped at 3 | Stops low-severity patients being ignored forever. |
| ALS preference | A BLS ambulance carrying a red patient adds a 5-minute equivalent penalty | Soft, not a hard rule. |
| ICU shortage penalty | 10 minutes | Applied when an ICU-needing casualty is sent to a hospital with no free ICU bed. Added in M0; not in the section 7.4 seed table. |
| Reassignment margin | 20 percent | Section 9.5. An ambulance en route is only reassigned if the new plan beats this. |
| Lambda (travel weight in the cost matrix) | 1 | Section 9.2. Weights travel minutes against severity benefit. |
| Fleet | 14 (5 ALS, 9 BLS) | Deliberately smaller than the casualty load. Scarcity is the point. |
| Casualty mix | 7 red, 14 yellow, 13 green, 2 black | |
| Start-of-run hospital occupancy | 25 to 45 percent, seeded | |
| ICU beds as a share of total, when unverified | 8 percent | Placeholder. Always labelled simulated. |
| Response target line | 20 minutes | The 108 service's stated urban average per team research. **Unverified** — must be confirmed against a primary source before any public claim. |

## Open items for a human

- Sign off the speed table, scenario scale and fleet size after seeing them run
  (section 18).
- Verify the 20-minute response target against a primary source, or remove the claim
  from public copy.
- Provide verified trauma, ICU and bed facts in `data/hospital-overrides.json` where
  they exist. Anything unverified stays labelled simulated.

## Added during the build

| Parameter | Value | Why |
| --- | --- | --- |
| A\* heuristic safety factor | 0.98 | The flat-map distance approximation can overestimate by up to ~0.6%; an overestimating heuristic breaks A\*'s optimality. Deflating it keeps the search admissible. |
| Metres per degree latitude / longitude | 110,692 / 111,413 | Evaluated for the study area's latitude (about 18.97 N) rather than the equatorial constants. |
| Decision feed window | 40 | How many recent decisions the UI keeps. Display only; does not affect the simulation or the ledger. |
| Starting hospital supplies | 40 blood, 60 oxygen units | Simulated. Section 7.4 fixes consumption per handover but not the opening stock. |
