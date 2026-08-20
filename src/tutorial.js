// COUNTERMINE -- the guided first dig.
// A step either waits for the player to DO something (`until`) or waits for a
// click on Understood. Steps that wait on an action never block the input they
// are asking for, so the lesson is played rather than read.

const $ = (id) => document.getElementById(id);

let api = null;        // { state(), view(), screen() }
let steps = [];
let idx = -1;
let active = false;
let onFinish = null;

export function tutorialActive() { return active; }

export function startTutorial(a, finish) {
  api = a; onFinish = finish;
  steps = buildSteps();
  idx = -1;
  active = true;
  bindOnce();
  next();
}

export function endTutorial(completed) {
  active = false;
  hideCoach();
  if (onFinish) onFinish(completed);
}

export function hideCoach() { const c = $('coach'); if (c) c.classList.remove('on'); }

let bound = false;
function bindOnce() {
  if (bound) return;
  bound = true;
  $('coachNext').addEventListener('click', () => next());
  $('coachSkip').addEventListener('click', () => endTutorial(false));
}

function next() {
  idx++;
  if (idx >= steps.length) { endTutorial(true); return; }
  show(steps[idx]);
}

function show(step) {
  const c = $('coach');
  $('coachTitle').textContent = step.title;
  $('coachText').innerHTML = step.text;
  $('coachStep').textContent = (idx + 1) + ' / ' + steps.length;
  $('coachNext').style.display = step.until ? 'none' : '';
  $('coachNext').textContent = step.button || 'Understood';
  c.classList.add('on');
  place(step);
  if (step.onShow) step.onShow();
}

function place(step) {
  const c = $('coach');
  const stage = $('stage');
  const sr = stage.getBoundingClientRect();
  let x = 878, y = 120;
  if (step.anchor === 'board') { x = 300; y = 210; }
  else if (step.anchor) {
    const el = $(step.anchor);
    if (el) {
      const r = el.getBoundingClientRect();
      const scale = sr.width ? (stage.offsetWidth / sr.width) : 1;
      x = (r.left - sr.left) * scale - 336;
      y = (r.top - sr.top) * scale;
      if (x < 8) x = (r.right - sr.left) * scale + 14;
    }
  }
  c.style.left = Math.max(8, Math.min(x, 1290 - 336)) + 'px';
  c.style.top = Math.max(8, Math.min(y, 660 - 150)) + 'px';
}

// Called every frame by the main loop. Auto-advances action steps.
export function tickTutorial() {
  if (!active || idx < 0 || idx >= steps.length) return;
  const step = steps[idx];
  if (!step.until) return;
  let ok = false;
  try { ok = step.until(api); } catch (e) { ok = false; }
  if (ok) {
    if (step.onDone) step.onDone();
    next();
  } else {
    place(step);
  }
}

function buildSteps() {
  return [
    {
      title: 'Set the line', anchor: 'party',
      text: 'This is your whole company. You brought two. Everyone else is somewhere '
        + 'below, still alive, and will only join if you go and get them.<br><br>'
        + 'Before a fight starts you can drag the line about: <b>click a soldier, then click a lit tile</b>.',
    },
    {
      title: 'Begin', anchor: 'abilities',
      text: 'Happy with where they stand? <b>Press Begin.</b>',
      until: (a) => a.state() && a.state().phase === 'player',
    },
    {
      title: 'One move, one action', anchor: 'abilities',
      text: 'Each soldier gets a move and then <b>one</b> action a round — an attack, '
        + 'or an ability. Not both.<br><br>The blue tiles are where the selected soldier can reach. '
        + '<b>Click one of them.</b>',
      until: (a) => {
        const st = a.state();
        return st && st.units.some(u => u.side === 'player' && u.alive && u.moved);
      },
    },
    {
      title: 'Now hit something', anchor: 'abilities',
      text: 'Red tiles are what you can reach from where you stand. '
        + '<b>Press Attack, then click a foe.</b><br><br>'
        + 'Hovering a foe first shows the exact damage you would do. Nothing here misses — '
        + 'the only question is whether the number is big enough.',
      until: (a) => {
        const st = a.state();
        return st && st.units.some(u => u.side === 'enemy' && u.dmgTaken > 0);
      },
    },
    {
      title: 'Flanking', anchor: 'inspect',
      text: 'Put a second soldier on the tile <b>directly opposite</b> the one already fighting, '
        + 'and every hit from that side lands for <b>+3</b>.<br><br>'
        + 'It is the whole reason position matters. Two soldiers pinching one foe beat two '
        + 'soldiers standing next to each other.',
    },
    {
      title: 'What they will do', anchor: 'threatBtn',
      text: 'The hatched red is everywhere the other side can reach and hit <b>next</b> round. '
        + 'Standing outside it is free; standing inside it is a decision.<br><br>'
        + '<b>Hover any single foe</b> to see just that one’s reach instead of all of them.',
    },
    {
      title: 'Wind-ups', anchor: 'inspect',
      text: 'Some things stop and raise a weapon instead of swinging. Those mark the '
        + '<b>exact tiles</b> they will hit at the start of their next turn, in bright orange.<br><br>'
        + 'Those tiles are always a mistake to stand in. The game will never hide which ones they are.',
    },
    {
      title: 'End the round', anchor: 'endBtn',
      text: 'When everyone has acted — or you are happy to hold — <b>End Turn</b>. '
        + 'Then they move.<br><br>Finish this fight. Nobody you lose comes back, so if a '
        + 'soldier is nearly out, pull them away rather than trading one last hit.',
      until: (a) => {
        const st = a.state();
        return !st || st.phase === 'won' || st.phase === 'lost' || st.phase === 'ending';
      },
      button: 'Fight',
    },
    {
      title: 'Recruiting', anchor: null,
      text: 'After every fight, three survivors offer to come with you. '
        + '<b>Click one to take them</b>, or leave them and take gold instead.<br><br>'
        + 'Four is the cap. Once you are full, taking a fifth means choosing who to '
        + 'leave in the dark — and that is a death sentence, not a bench.',
      onShow: () => { const c = $('coach'); c.classList.add('noArrow'); c.style.left = '470px'; c.style.top = '330px'; },
      onDone: () => $('coach').classList.remove('noArrow'),
    },
  ];
}
