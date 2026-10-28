import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');

// Execute the real editor functions with a minimal DOM/API double, without
// adding jsdom or a frontend framework to this otherwise dependency-free app.
function functionSource(name) {
  const declaration = name === 'submitAccountEdit' ? 'async function ' : 'function ';
  const begin = source.indexOf(declaration + name + '(');
  assert.ok(begin >= 0, name + ' must exist');
  const end = source.indexOf('\n}', begin);
  assert.ok(end > begin, 'end of ' + name + ' not found');
  return source.slice(begin, end + 2);
}

function setup() {
  const dialog = {
    dataset: {},
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  const nodes = {
    '#accountDialog': dialog,
    '#editTitle': { textContent: '' },
    '#editHelp': { textContent: '' },
    '#editFields': { innerHTML: '' },
    '#cancelEdit': { textContent: '' },
    '#confirmEdit': { textContent: '' },
    '#editValue': { focus() {} }
  };
  const calls = [];
  const editor = new Function(
    '$', 't', 'escapeHTML', 'request', 'refresh', 'render', 'notify',
    functionSource('showGroupEditor') + '\n' +
      functionSource('submitAccountEdit') +
      '\nreturn {showGroupEditor, submitAccountEdit};'
  )(
    key => nodes[key],
    key => key,
    value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
    async (...args) => { calls.push(args); return {}; },
    async () => {},
    async () => {},
    () => {}
  );
  return { dialog, nodes, calls, ...editor };
}

test('Confirm on New group does not get dispatched as a New group action again', async () => {
  const ui = setup();
  ui.showGroupEditor('groupCreate');

  assert.equal(ui.dialog.dataset.editorAction, 'groupCreate');
  // This used to exist on the ancestor dialog and matched the global
  // document.click [data-action] selector, reopening the editor and erasing input.
  assert.equal(ui.dialog.dataset.action, undefined);
  assert.equal(ui.dialog.open, true);
  assert.match(ui.nodes['#editFields'].innerHTML, /name="value"[^>]*required/);

  await ui.submitAccountEdit({ elements: { namedItem: () => ({ value: 'Emergency savings' }) } });
  assert.deepEqual(ui.calls, [['/groups', 'POST', { name: 'Emergency savings' }]]);
  assert.equal(ui.dialog.open, false);
});

test('Rename group submits the edited name rather than recreating its input', async () => {
  const ui = setup();
  ui.showGroupEditor('groupRename', { id: 12, name: 'Cash' });
  assert.equal(ui.dialog.dataset.editorAction, 'groupRename');
  assert.equal(ui.dialog.dataset.id, '12');
  assert.equal(ui.dialog.dataset.action, undefined);

  await ui.submitAccountEdit({ elements: { namedItem: () => ({ value: 'Everyday accounts' }) } });
  assert.deepEqual(ui.calls, [['/groups/12', 'PATCH', { name: 'Everyday accounts' }]]);
  assert.equal(ui.dialog.open, false);
});
