import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../src/app/history.js';

const clock = () => { let t = 0; const now = () => t; now.advance = (ms) => { t += ms; }; return now; };

test('undo and redo walk back and forward through the changes', () => {
  const h = createHistory();
  h.reset('C');
  h.push('C | F');
  h.push('C | F | G');
  assert.equal(h.undo(), 'C | F');
  assert.equal(h.undo(), 'C');
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), 'C | F');
  assert.equal(h.redo(), 'C | F | G');
  assert.equal(h.redo(), null);
});

test('can-undo and can-redo follow the position', () => {
  const h = createHistory();
  h.reset('C');
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  h.push('F');
  assert.equal(h.canUndo, true);
  h.undo();
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
});

test('the same text is not a new step', () => {
  const h = createHistory();
  h.reset('C');
  assert.equal(h.push('C'), false);
  assert.equal(h.canUndo, false);
});

test('a new change after an undo ends the redo', () => {
  const h = createHistory();
  h.reset('A');
  h.push('B');
  h.push('C');
  h.undo();
  h.push('D');
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(), 'B');
});

test('typing close together is one step; a pause, or a different kind of change, starts a new one', () => {
  const now = clock();
  const h = createHistory({ now, coalesceMs: 800 });
  h.reset('C');
  h.push('C F', { kind: 'typing' }); // starts a step
  now.advance(300);
  h.push('C F G', { kind: 'typing' }); // joins it
  now.advance(300);
  h.push('C F G7', { kind: 'typing' }); // joins it
  assert.equal(h.undo(), 'C');
  assert.equal(h.redo(), 'C F G7');

  now.advance(2000);
  h.push('C F G7 A', { kind: 'typing' }); // too late: its own step
  assert.equal(h.undo(), 'C F G7');

  h.redo();
  h.push('picked', { kind: 'edit' }); // a picker edit never merges with typing
  h.push('picked 2', { kind: 'edit' });
  assert.equal(h.undo(), 'picked');
  assert.equal(h.undo(), 'C F G7 A');
});

test('undoing in the middle of a burst of typing never merges the next typing into an old step', () => {
  const now = clock();
  const h = createHistory({ now });
  h.reset('A');
  h.push('AB', { kind: 'typing' });
  h.undo();
  now.advance(100);
  h.push('AC', { kind: 'typing' });
  assert.equal(h.undo(), 'A');
});

test('it keeps at most `limit` steps, dropping the oldest', () => {
  const h = createHistory({ limit: 3 });
  h.reset('0');
  for (const t of ['1', '2', '3', '4']) h.push(t);
  assert.equal(h.undo(), '3');
  assert.equal(h.undo(), '2');
  assert.equal(h.undo(), null);
});

test('pushing before any reset starts the history from that text', () => {
  const h = createHistory();
  assert.equal(h.push('C'), false);
  h.push('F');
  assert.equal(h.undo(), 'C');
});
