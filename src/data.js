// COUNTERMINE -- static content. No engine logic lives here.
// A siege that went underground: two armies broke into the under-levels of a
// fortress years ago and neither came back out.

// ---------------------------------------------------------------- abilities
// kind is resolved by engine.resolveAbility(). target decides the picker UI.
//   target: 'self' | 'enemy' | 'ally' | 'tile' | 'dir'
export const ABILITIES = {
  // --- Serjeant
  rally: {
    name: 'Rally', mana: 2, cd: 3, target: 'ally', range: 3, kind: 'buff',
    status: 'rallied', dur: 2,
    desc: 'An ally in earshot hits for +3 until your next turn.',
  },
  hold_line: {
    name: 'Hold the Line', mana: 2, cd: 4, target: 'self', kind: 'aura_guard', radius: 1, dur: 1,
    desc: 'You and every ally beside you take 3 less damage this round.',
  },
  // --- Pavisier
  plant_pavise: {
    name: 'Plant Pavise', mana: 2, cd: 3, target: 'tile', range: 1, kind: 'place_barricade', hp: 10,
    desc: 'Drive the shield into the floor. Blocks movement and shot until broken.',
  },
  shield_wall: {
    name: 'Shield Wall', mana: 2, cd: 3, target: 'self', kind: 'aura_guard', radius: 1, dur: 1,
    desc: 'Allies beside you take 4 less damage this round.',
  },
  // --- Crossbowman
  punch_through: {
    name: 'Punch Through', mana: 3, cd: 3, target: 'enemy', range: 5, minRange: 2, kind: 'attack',
    pierce: true, dmg: [8, 12], needsLoad: true,
    desc: 'A bolt that does not care about plate. Ignores armour. Needs a loaded bow.',
  },
  pin: {
    name: 'Pin', mana: 2, cd: 3, target: 'enemy', range: 5, minRange: 2, kind: 'attack',
    dmg: [4, 6], status: 'pinned', dur: 1, needsLoad: true,
    desc: 'Nail a leg to the floor. Target cannot move next turn.',
  },
  // --- Sapper
  set_charge: {
    name: 'Set Charge', mana: 3, cd: 4, target: 'tile', range: 3, kind: 'bomb',
    fuse: 1, radius: 1, dmg: [9, 14],
    desc: 'Powder on the stone. Blows at the end of the next enemy turn -- it does not know whose side you are on.',
  },
  pickaxe: {
    name: 'Pickaxe', mana: 1, cd: 2, target: 'enemy', range: 1, kind: 'attack',
    pierce: true, dmg: [6, 9],
    desc: 'Ignores armour. Tears barricades apart outright.',
  },
  // --- Surgeon
  stitch: {
    name: 'Stitch', mana: 2, cd: 2, target: 'ally', range: 2, kind: 'heal', amount: [7, 10], charges: 3,
    desc: 'Close a wound. Three times a battle, no more -- the thread runs out.',
  },
  draught: {
    name: 'Draught', mana: 2, cd: 3, target: 'ally', range: 2, kind: 'cleanse',
    desc: 'Clears bleed and pin, and gives the drinker +2 movement next turn.',
  },
  // --- Billman
  hook: {
    name: 'Hook', mana: 2, cd: 2, target: 'enemy', range: 3, minRange: 2, kind: 'pull', dmg: [3, 5],
    desc: 'Drag a man one tile toward you. Off the line, out of the wall.',
  },
  sweep: {
    name: 'Sweep', mana: 3, cd: 3, target: 'dir', kind: 'cone', dmg: [6, 9],
    desc: 'A wide swing down one lane -- four tiles, everything standing in them.',
  },
  // --- Cutthroat
  slip: {
    name: 'Slip', mana: 2, cd: 2, target: 'tile', range: 4, kind: 'blink',
    desc: 'Through the gap. Move to any open tile within 4, past anything in the way.',
  },
  gut: {
    name: 'Gut', mana: 3, cd: 3, target: 'enemy', range: 1, kind: 'attack', dmg: [5, 7],
    status: 'bleed', dur: 3, val: 3,
    desc: 'Opens them up. 3 damage a turn for three turns, and armour does not stop bleeding.',
  },
  // --- Flagellant
  litany: {
    name: 'Litany', mana: 3, cd: 4, target: 'self', kind: 'aura_buff', radius: 2,
    status: 'rallied', dur: 2, selfDmg: 4,
    desc: 'Scream scripture. Every ally within 2 hits for +3. Costs you 4 of your own blood.',
  },
  martyr: {
    name: 'Martyr', mana: 3, cd: 4, target: 'ally', range: 3, kind: 'martyr', dur: 1,
    desc: 'Take an allys wounds onto yourself until your next turn.',
  },

  // ------------------------------------------------ captain signature spells
  sig_rally: {
    name: 'Rally', mana: 2, cd: 3, target: 'ally', range: 3, kind: 'buff', status: 'rallied', dur: 2,
    desc: 'An ally in earshot hits for +3 until your next turn.',
    long: 'Martial. The safest pick: turn somebody else into the killer this round.',
  },
  sig_hold: {
    name: 'Hold the Line', mana: 2, cd: 3, target: 'self', kind: 'aura_guard', radius: 1, dur: 1,
    desc: 'You and everyone beside you take 4 less damage this round.',
    long: 'Martial. Walk into the worst tile on the board on purpose, and survive it.',
  },
  sig_hew: {
    name: 'Hew', mana: 3, cd: 3, target: 'dir', kind: 'cone', dmg: [6, 9],
    desc: 'A swing down one lane: four tiles, everything standing in them.',
    long: 'Martial. For when three of them come at you down a corridor.',
  },
  sig_ember: {
    name: 'Emberbrand', mana: 3, cd: 3, target: 'enemy', range: 4, minRange: 1, kind: 'attack',
    dmg: [6, 9], status: 'burning', dur: 2, val: 3,
    desc: 'Fire at range 4. Sets the target burning for 3 a turn, twice.',
    long: 'Arcane. Reach past the front line, and armour does not stop the burning.',
  },
  sig_grave: {
    name: 'Grave-Light', mana: 3, cd: 2, target: 'ally', range: 3, kind: 'heal',
    amount: [8, 12], charges: 2,
    desc: 'Close an ally’s wounds at range 3. Twice a battle.',
    long: 'Arcane. Buys a soldier one more round. Two of them, then it is spent.',
  },
  sig_oath: {
    name: 'Iron Oath', mana: 4, cd: 4, target: 'self', kind: 'oath', dur: 2, guard: 5,
    desc: 'Take 5 less damage and drag every nearby foe onto you for two rounds.',
    long: 'Arcane. You become the answer to every question they were about to ask.',
  },

  // ---- calling-specific signatures
  sig_barb: {
    name: 'Barbed Shot', mana: 3, cd: 3, target: 'enemy', range: 4, minRange: 2, kind: 'attack',
    dmg: [5, 8], status: 'pinned', dur: 1,
    desc: 'An arrow through the leg at range 4. The target cannot move next turn.',
    long: 'Ranger. Hold the distance; decide where they stand.',
  },
  sig_slip: {
    name: 'Slip', mana: 2, cd: 2, target: 'tile', range: 4, kind: 'blink',
    desc: 'Move to any open tile within 4, past anything in the way. Does not end your turn.',
    long: 'Through the gap, behind the line.',
  },
  sig_shiv: {
    name: 'Shiv', mana: 3, cd: 3, target: 'enemy', range: 1, kind: 'attack', dmg: [5, 7],
    status: 'bleed', dur: 3, val: 3,
    desc: 'Open them up: 3 damage a turn for three turns, and armour does not stop bleeding.',
    long: 'Rogue. The wound that keeps working after you leave.',
  },
  sig_trick: {
    name: 'Dirty Trick', mana: 2, cd: 3, target: 'enemy', range: 2, kind: 'attack', dmg: [4, 6],
    status: 'pinned', dur: 1,
    desc: 'Sand in the eyes, a knee somewhere soft. Damage, and they cannot move next turn.',
    long: 'Rogue. Nobody said this had to be honourable.',
  },

  // --------------------------------------------------------- enemy abilities
  e_smash: {
    name: 'Maul', cd: 3, target: 'windup_area', range: 1, kind: 'windup', radius: 1,
    dmg: [10, 15], telegraphTurns: 1,
    desc: 'Winds up, then flattens a 3x3.',
  },
  e_volley: {
    name: 'Volley', cd: 2, target: 'windup_line', range: 7, kind: 'windup', dmg: [8, 11],
    telegraphTurns: 1, desc: 'Marks a lane and looses down it next turn.',
  },
  e_leap: {
    name: 'Leap', cd: 3, target: 'enemy', range: 5, kind: 'leap', dmg: [6, 9],
    desc: 'Jumps the line and lands on your soft parts.',
  },
  e_goad: {
    name: 'Goad', cd: 2, target: 'self', kind: 'aura_buff', radius: 2, status: 'rallied', dur: 2,
    desc: 'Drives the ones around it forward.',
  },
  e_collapse: {
    name: 'Collapse the Roof', cd: 4, target: 'windup_col', kind: 'windup', dmg: [12, 18],
    telegraphTurns: 1, desc: 'Brings a whole column of ceiling down.',
  },
  e_breach: {
    name: 'BREACH', cd: 4, target: 'windup_row', kind: 'windup', dmg: [9, 14],
    telegraphTurns: 1,
    desc: 'Telegraphs a whole lane, then comes down it -- through soldiers, barricades, and the wall itself.',
  },
  e_summon: {
    name: 'Call the Starving', cd: 3, target: 'self', kind: 'summon', unit: 'starveling', count: 2,
    desc: 'Whistles up whatever is still living in the rubble.',
  },
  e_lob: {
    name: 'Firepot', cd: 3, target: 'windup_area', range: 5, kind: 'windup', radius: 1,
    dmg: [7, 11], telegraphTurns: 1, arcs: true,
    desc: 'Lobs a clay pot of burning pitch over anything in the way. Flattens a 3x3.',
  },
  e_mend: {
    name: 'Sump Chant', cd: 2, target: 'ally', range: 4, kind: 'heal', amount: [7, 10],
    desc: 'Drones the old work-song and the dead knit shut.',
  },
  e_drag: {
    name: 'Drag Under', cd: 3, target: 'enemy', range: 4, minRange: 2, kind: 'pull', dmg: [5, 8],
    desc: 'Hauls a body toward it.',
  },
};

// ------------------------------------------------------------------ classes
// mov = tiles per turn (orthogonal). atk = base attack damage range.
// The player's own officer. Stats come from the creator's allotment, and the
// single signature spell is what makes two captains play differently -- recruits
// carry two abilities each precisely so the captain is not just "a better one".
export const CAPTAIN_BASE = {
  id: 'captain', name: 'Captain', short: 'CPT', role: 'Your officer',
  colour: '#e0b45c',
  hp: 22, mov: 3, armor: 0, range: 1, atk: [5, 7],
  abilities: ['sig_hold'], locked: false, isCaptain: true,
  blurb: 'Signed for the company. Nobody made them do it.',
};

// The captain's CALLING: a real class, not a costume. Each has its own basic
// attack, its own trio of signatures, and a bearing that fits.
export const CALLINGS = [
  {
    id: 'knight', name: 'Knight', glyph: '⚔',
    blurb: 'Steel in the line. Hits at arm’s length and holds what it takes.',
    base: { hp: 24, mov: 3, armor: 1, range: 1, atk: [5, 7] },
    sigs: ['sig_rally', 'sig_hold', 'sig_hew'],
    look: { weapon: 'sword', helm: 'conical', robe: false },
  },
  {
    id: 'ranger', name: 'Ranger', glyph: '➶',
    blurb: 'Shoots at range 2–4 and never wants you closer. Softer up close.',
    base: { hp: 20, mov: 4, armor: 0, range: 4, minRange: 2, atk: [4, 6] },
    sigs: ['sig_barb', 'sig_slip', 'sig_hold'],
    look: { weapon: 'bow', helm: 'round', robe: false },
  },
  {
    id: 'mage', name: 'Magus', glyph: '◈',
    blurb: 'A bolt at range 2 and the deepest signatures. Thin as a candle.',
    base: { hp: 18, mov: 3, armor: 0, range: 2, atk: [4, 6] },
    sigs: ['sig_ember', 'sig_grave', 'sig_oath'],
    look: { weapon: 'staff', helm: 'hood', robe: true },
  },
  {
    id: 'rogue', name: 'Rogue', glyph: '†',
    blurb: 'Fast, vicious behind a foe (+3 more when flanking), fragile in front of one.',
    base: { hp: 19, mov: 5, armor: 0, range: 1, atk: [5, 7], flankBonus: 3 },
    sigs: ['sig_slip', 'sig_shiv', 'sig_trick'],
    look: { weapon: 'knife', helm: 'hood', robe: false },
  },
];

export const ALLOTMENT = 8;
export const STAT_LINES = [
  { id: 'vigour', name: 'Vigour', max: 3, per: 4, unit: 'health',
    text: '+4 maximum health a point. More rounds on your feet.' },
  { id: 'haste', name: 'Haste', max: 3, per: 1, unit: 'movement',
    text: '+1 movement a point. Reach the flank on the turn it matters.' },
  { id: 'plate', name: 'Plate', max: 3, per: 1, unit: 'armour',
    text: '+1 armour a point, taken off every hit. Useless against bleeding and fire.' },
  { id: 'might', name: 'Might', max: 3, per: 2, unit: 'damage',
    text: '+2 damage a point on every attack you make.' },
  { id: 'arcana', name: 'Arcana', max: 3, per: 2, unit: 'sig power',
    text: '+2 a point on signature damage AND healing. The weapon arm never benefits.' },
  { id: 'spirit', name: 'Spirit', max: 3, per: 2, unit: 'mana',
    text: '+2 company mana a point. The whole company draws on your will.' },
];
// The arm is a build choice: range, weight, and how honest the swing is.
export const WEAPONS = {
  sword: { name: 'Sword',  dmg: 0,  hit: 0,   lore: 'Issue steel, third pattern. It has outlived two owners and holds an edge out of habit.' },
  maul:  { name: 'Maul',   dmg: 2,  hit: -10, lore: 'A miner\u2019s maul from before the siege. It was breaking stone while you were learning to walk; men are softer.' },
  knife: { name: 'Knife',  dmg: -1, hit: 5, flank: 2, lore: 'Short, quick, and honest about nothing. Loves a turned back.' },
  pole:  { name: 'Billhook', dmg: -1, range: 2, lore: 'Farm tool, then wall weapon. Reaches over a shoulder and pulls the fight to you.' },
  shield:{ name: 'Shield', dmg: -2, armor: 1, lore: 'A pavise cut down to one arm. You stopped counting the bolts in it.' },
  bow:   { name: 'Bow', dmg: 0, hit: 0, lore: 'Laminated horn, kept dry eleven years. The string is worth more than the quartermaster\u2019s ledger.' },
  staff: { name: 'Staff', dmg: 0, hit: 0, lore: 'Cut from a gallery prop that would not burn. Whatever is in the deep stone came up the grain.' },
};

export const SIGNATURES = ['sig_rally', 'sig_hold', 'sig_hew', 'sig_ember', 'sig_grave', 'sig_oath'];

// Where the captain was before the stair. A past, and one small edge from it —
// options, never raw power, same law as everything else in the meta.
export const ORIGINS = [
  {
    id: 'deserter', name: 'The Deserter',
    past: 'You wore the other colours for three years. When your column was ordered down, you went over the wall instead — with the pay chest’s loose corner in your pack. Now you go down anyway, on your own terms.',
    boon: '+40 starting gold', boonKey: 'gold',
  },
  {
    id: 'mason', name: 'The Mason’s Child',
    past: 'Your family built the east wall, course by course, and you learned the trade in its shadow. You were there the morning it came down. You know what the stone owes you.',
    boon: 'Begin with the Mail Scraps relic', boonKey: 'scraps',
  },
  {
    id: 'bonesetter', name: 'The Bonesetter',
    past: 'You set fractures in the siege camps for a decade — both camps, when the pay ran that way. Old habits: you check your own wounds first, and you check them well.',
    boon: 'Your captain recovers 4 health after every battle', boonKey: 'mend',
  },
  {
    id: 'gravedigger', name: 'The Gravedigger',
    past: 'Somebody had to bury what came back up. You listened to the survivors while you worked, and you wrote down what they said between the prayers.',
    boon: 'The Ledger begins knowing every foe of Floor 1', boonKey: 'ledger',
  },
];

export const CLASSES = {
  serjeant: {
    id: 'serjeant', name: 'Serjeant', short: 'SRJ', role: 'Line officer',
    colour: '#d4823c',
    hp: 26, mov: 4, armor: 1, range: 1, atk: [6, 9],
    abilities: ['rally', 'hold_line'], starter: true, locked: false,
    blurb: 'Held the breach for eleven days. Nobody relieved him.',
  },
  pavisier: {
    id: 'pavisier', name: 'Pavisier', short: 'PAV', role: 'Shield',
    colour: '#7d9ec4',
    hp: 34, mov: 3, armor: 3, range: 1, atk: [4, 6],
    abilities: ['plant_pavise', 'shield_wall'], locked: false,
    blurb: 'Carries a door for a shield. It has three bolts still in it.',
  },
  crossbow: {
    id: 'crossbow', name: 'Crossbowman', short: 'XBW', role: 'Shot',
    colour: '#a8b060',
    hp: 18, mov: 3, armor: 0, range: 5, minRange: 2, atk: [8, 11], reload: true,
    abilities: ['punch_through', 'pin'], locked: false,
    blurb: 'Every shot costs a turn of winding. He thinks it is worth it.',
  },
  surgeon: {
    id: 'surgeon', name: 'Surgeon', short: 'SRG', role: 'Wounds',
    colour: '#8fc498',
    hp: 20, mov: 3, armor: 0, range: 1, atk: [3, 5],
    abilities: ['stitch', 'draught'], locked: false,
    blurb: 'Ran out of anaesthetic in the first winter. Kept operating.',
  },
  sapper: {
    id: 'sapper', name: 'Sapper', short: 'SAP', role: 'Powder',
    colour: '#e0894a',
    hp: 20, mov: 4, armor: 0, range: 1, atk: [4, 7],
    abilities: ['set_charge', 'pickaxe'], locked: true, cost: 90,
    blurb: 'Dug the countermine. Knows which walls are only pretending.',
  },
  billman: {
    id: 'billman', name: 'Billman', short: 'BIL', role: 'Reach',
    colour: '#6fbcb0',
    hp: 24, mov: 3, armor: 1, range: 2, minRange: 1, atk: [5, 8],
    abilities: ['hook', 'sweep'], locked: true, cost: 90,
    blurb: 'Eight feet of pole and a hook for pulling men off walls.',
  },
  cutthroat: {
    id: 'cutthroat', name: 'Cutthroat', short: 'CUT', role: 'Knife',
    colour: '#b08ad0',
    hp: 15, mov: 5, armor: 0, range: 1, atk: [6, 8], flankBonus: 4,
    abilities: ['slip', 'gut'], locked: true, cost: 120,
    blurb: 'Was not a soldier before the siege. Is one of the best of them now.',
  },
  flagellant: {
    id: 'flagellant', name: 'Flagellant', short: 'FLG', role: 'Faith',
    colour: '#d06a5a',
    hp: 22, mov: 4, armor: 0, range: 1, atk: [5, 9],
    abilities: ['litany', 'martyr'], locked: true, cost: 120,
    blurb: 'Believes the dark under the fortress is a punishment, and deserved.',
  },
};

// ------------------------------------------------------------------ enemies
export const ENEMIES = {
  starveling: {
    id: 'starveling', name: 'Starveling', short: 'STV',
    hp: 9, mov: 5, armor: 0, range: 1, atk: [3, 5], abilities: [], threat: 1,
    blurb: 'Was a soldier. Is now mostly appetite.',
  },
  trencher: {
    id: 'trencher', name: 'Trencher', short: 'TRN',
    hp: 22, mov: 3, armor: 3, range: 2, minRange: 1, atk: [6, 9], abilities: [], threat: 3,
    blurb: 'Still holds his section of a line that stopped mattering years ago.',
  },
  arbalest: {
    id: 'arbalest', name: 'Arbalest', short: 'ARB',
    hp: 14, mov: 2, armor: 0, range: 7, minRange: 2, atk: [6, 8],
    abilities: ['e_volley'], threat: 3,
    blurb: 'Fires from the dark. You see the lane before you see him.',
  },
  ironhusk: {
    id: 'ironhusk', name: 'Ironhusk', short: 'IRN',
    hp: 34, mov: 2, armor: 4, range: 1, atk: [7, 10],
    abilities: ['e_smash'], threat: 5,
    blurb: 'Sealed into its own armour. Whatever is inside has stopped complaining.',
  },
  hound: {
    id: 'hound', name: 'Cellar Hound', short: 'HND',
    hp: 13, mov: 4, armor: 0, range: 1, atk: [5, 8],
    abilities: ['e_leap'], threat: 3,
    blurb: 'Goes for the ones at the back. It has learned which those are.',
  },
  bellman: {
    id: 'bellman', name: 'Bellman', short: 'BEL',
    hp: 16, mov: 3, armor: 1, range: 1, atk: [3, 5],
    abilities: ['e_goad'], threat: 4,
    blurb: 'Rings the advance. Nobody told him the assault ended.',
  },
  lobber: {
    id: 'lobber', name: 'Firepot Lobber', short: 'LOB',
    hp: 12, mov: 2, armor: 0, range: 2, minRange: 1, atk: [3, 5],
    abilities: ['e_lob'], threat: 4,
    blurb: 'Still has pots left from the siege. Does not aim at anyone in particular -- at everyone.',
  },
  chanter: {
    id: 'chanter', name: 'Sump Chanter', short: 'CHT',
    hp: 14, mov: 3, armor: 0, range: 2, minRange: 1, atk: [3, 5],
    abilities: ['e_mend'], threat: 4,
    blurb: 'Sings the wounded back onto their feet. Kill the song first.',
  },
  pyreling: {
    id: 'pyreling', name: 'Pyre Husk', short: 'PYR',
    hp: 8, mov: 4, armor: 0, range: 1, atk: [3, 5],
    abilities: [], threat: 2, explode: [6, 9],
    blurb: 'Packed with siege powder that never went off. It goes off.',
  },
  drowned: {
    id: 'drowned', name: 'Sump-Drowned', short: 'DRW',
    hp: 20, mov: 3, armor: 1, range: 1, atk: [5, 8],
    abilities: ['e_drag'], threat: 4,
    blurb: 'Came up out of the flooded galleries and did not stop coming up.',
  },
};

export const BOSSES = {
  breacher: {
    id: 'breacher', name: 'THE BREACHER', short: 'BCH', boss: true,
    hp: 90, mov: 3, armor: 3, range: 1, atk: [9, 13],
    abilities: ['e_smash', 'e_breach'], threat: 12,
    blurb: 'It brought the wall down on both armies and then kept working.',
  },
  choirmaster: {
    id: 'choirmaster', name: 'THE BELL-CHOIR', short: 'CHR', boss: true,
    hp: 96, mov: 3, armor: 2, range: 2, minRange: 1, atk: [8, 11],
    abilities: ['e_goad', 'e_volley', 'e_summon'], threat: 14,
    blurb: 'Four bells, one voice, and a great many men who still answer it.',
  },
  undermaster: {
    id: 'undermaster', name: 'THE UNDERMASTER', short: 'UND', boss: true,
    hp: 120, mov: 3, armor: 4, range: 2, minRange: 1, atk: [10, 15],
    abilities: ['e_collapse', 'e_drag', 'e_summon'], threat: 20,
    blurb: 'Dug the first countermine. Never gave the order to stop digging.',
  },
};

// ------------------------------------------------------------------- relics
// Party-wide, Hades-style. Five slots; the sixth pickup forces a swap.
export const RELICS = [
  { id: 'wedge', name: 'Breachmans Wedge', cost: 70, locked: false,
    text: '+3 damage against anything wearing armour.' },
  { id: 'rations', name: 'Siege Rations', cost: 70, locked: false,
    text: 'Every unit has +5 maximum health.' },
  { id: 'scraps', name: 'Mail Scraps', cost: 70, locked: false,
    text: '+1 armour for the whole company.' },
  { id: 'whistle', name: 'Dead Mans Whistle', cost: 80, locked: false,
    text: 'Killing a foe gives the killer +2 movement next turn.' },
  { id: 'flensing', name: 'Flensing Knives', cost: 80, locked: false,
    text: 'Flanking bonus raised from 3 to 6.' },
  { id: 'tourniquet', name: 'Tourniquet Kit', cost: 80, locked: false,
    text: 'Healing restores 4 more, and Stitch gets a fourth charge.' },
  { id: 'coin', name: 'Widows Coin', cost: 60, locked: false,
    text: '+30 gold from every battle.' },
  { id: 'quarrels', name: 'Long Watch Quarrels', cost: 90, locked: false,
    text: 'The crossbow starts every battle with a free extra shot in hand.' },
  { id: 'oil', name: 'Oil-Soaked Rags', cost: 110, locked: true, boss: 'breacher',
    text: 'Your attacks set the target burning: 3 damage a turn for 2 turns.' },
  { id: 'charts', name: 'Countermine Charts', cost: 90, locked: true, boss: 'undermaster',
    text: 'Camps also patch every unit for 6, and vendor prices drop by a fifth.' },
  { id: 'reliquary', name: 'Cracked Reliquary', cost: 140, locked: true, boss: 'choirmaster',
    text: 'The first of yours to fall each battle bursts for 10 to everything adjacent.' },
  { id: 'sallyport', name: 'Sallyport Key', cost: 100, locked: true, boss: 'breacher',
    text: 'Deploy one column further forward.' },
  { id: 'grudge', name: 'Pikemans Grudge', cost: 100, locked: true, boss: 'choirmaster',
    text: 'Attacks made at range 2 or more deal +3.' },
  { id: 'ironrations', name: 'Cold Iron Rations', cost: 120, locked: true, boss: 'undermaster',
    text: 'Every surviving unit heals 6 after each battle.' },
];

// ------------------------------------------------------------------- floors
export const FLOORS = [
  {
    n: 1, name: 'THE BREACH', sub: 'Where the wall came down on both of them.',
    palette: { floor: '#2b2724', wall: '#4e453f', accent: '#6a4a2f' },
    pool: ['starveling', 'starveling', 'trencher', 'arbalest', 'hound', 'pyreling'],
    elitePool: ['ironhusk', 'bellman'],
    budget: [7, 11], eliteBudget: 13, boss: 'breacher', gold: [45, 70],
  },
  {
    n: 2, name: 'THE SUMP GALLERIES', sub: 'Flooded in the second year. Still garrisoned.',
    palette: { floor: '#232a2b', wall: '#3d4c49', accent: '#3f6360' },
    pool: ['starveling', 'trencher', 'arbalest', 'hound', 'drowned', 'bellman', 'lobber', 'chanter'],
    elitePool: ['ironhusk', 'drowned', 'lobber'],
    budget: [12, 17], eliteBudget: 19, boss: 'choirmaster', gold: [60, 90],
  },
  {
    n: 3, name: 'THE COUNTERMINE', sub: 'Neither army dug this one.',
    palette: { floor: '#2a2226', wall: '#483d44', accent: '#6b3546' },
    pool: ['trencher', 'arbalest', 'hound', 'drowned', 'bellman', 'ironhusk', 'lobber', 'chanter', 'pyreling'],
    elitePool: ['ironhusk', 'ironhusk', 'bellman', 'chanter'],
    budget: [17, 22], eliteBudget: 24, boss: 'undermaster', gold: [80, 120],
  },
];

export const NAMES = [
  'Halke', 'Orrin', 'Mabb', 'Cressel', 'Tarrow', 'Idren', 'Bly', 'Sarn',
  'Vetch', 'Corliss', 'Neame', 'Wick', 'Dunnock', 'Ferrers', 'Ost', 'Hallam',
  'Rooke', 'Merrow', 'Cadge', 'Selby', 'Thwaite', 'Gorse', 'Pell', 'Ryke',
];

export const DEATH_LINES = [
  'went down in the dark and stayed there.',
  'is left where they fell. There is no time.',
  'stopped. The others did not look back.',
  'is another mark on the wall.',
  'will not be relieved either.',
];
