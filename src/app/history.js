// Undo and redo for the progression text. Pure: it only remembers snapshots of the text; applying one is the caller's job.
//
// Typing is saved as one step per burst (letters typed close together undo together). Every other change, such as a chord
// picked in the editor, a quick progression, or a key change that rewrites the chords, is a step of its own.

/**
 * @param {{limit?: number, coalesceMs?: number, now?: () => number}} [opts]
 */
export function createHistory({ limit = 100, coalesceMs = 800, now = () => Date.now() } = {}) {
  /** @type {string[]} */
  let entries = [];
  let at = -1;
  let lastKind = null;
  let lastAt = 0;

  return {
    /** Start over from this text (nothing to undo or redo). */
    reset(text) {
      entries = [String(text)];
      at = 0;
      lastKind = null;
    },

    /** Remember a change. Returns false when the text is the same as now (nothing to remember). */
    push(text, { kind = 'edit' } = {}) {
      const value = String(text);
      if (at < 0) { this.reset(value); return false; }
      if (value === entries[at]) return false;
      entries = entries.slice(0, at + 1); // a new change ends any redo
      const t = now();
      if (kind === 'typing' && lastKind === 'typing' && at > 0 && t - lastAt <= coalesceMs) {
        entries[at] = value;
      } else {
        entries.push(value);
        at = entries.length - 1;
        if (entries.length > limit) { entries.shift(); at -= 1; }
      }
      lastKind = kind;
      lastAt = t;
      return true;
    },

    /** The previous text, or null if there is none. */
    undo() {
      if (at <= 0) return null;
      at -= 1;
      lastKind = null;
      return entries[at];
    },

    /** The next text, or null if there is none. */
    redo() {
      if (at < 0 || at >= entries.length - 1) return null;
      at += 1;
      lastKind = null;
      return entries[at];
    },

    get canUndo() { return at > 0; },
    get canRedo() { return at >= 0 && at < entries.length - 1; },
  };
}
