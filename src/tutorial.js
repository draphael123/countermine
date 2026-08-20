// COUNTERMINE -- the guided first dig.
// A step either waits for the player to DO something (`until`) or waits for a
// click on Understood. Steps that wait on an action never block the input they
// are asking for, so the lesson is played rather than read.

const $ = (id) => document.getElementById(id);

let pulsed = null;
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

export function hideCoach() {
  const c = $('coach');
  if (c) c.classList.remove('on');
  if (pulsed) { pulsed.classList.remove('pulseTarget'); pulsed = null; }
}

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

// The coach is DOCKED (fixed position in CSS) rather than floated next to its
// subject -- a box that jumps around the screen is much harder to follow than
// one place to look plus a pulse on the control it is talking about.
function place(step) {
  const c = $('coach');
  const battle = $('battle');
  const side = $('side');
  if (battle && side) {
    // sit just below the ability panel, clamped to the stage
    c.style.top = '86px';
  }
  if (pulsed) { pulsed.classList.remove('pulseTarget'); pulsed = null; }
  if (step.anchor && step.anchor !== 'board') {
    const el = $(step.anchor);
    if (el) { el.classList.add('pulseTarget'); pulsed = el; }
  }
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
    // No recruiting step: the coach lives inside the battle screen, which is
    // gone by the time the recruit modal opens -- it could never display. The
    // recruit screen carries its own instructions instead.
  ];
}
