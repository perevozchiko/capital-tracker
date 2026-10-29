import test from 'node:test';
import assert from 'node:assert/strict';
import { showTypedConfirm } from '../web/js/dialogs.js';

function fixture() {
  const dialog = new EventTarget();
  dialog.open = false;
  dialog.returnValue = '';
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = (value) => {
    dialog.returnValue = value;
    dialog.open = false;
    dialog.dispatchEvent(new Event('close'));
  };
  const form = new EventTarget();
  const input = new EventTarget();
  input.value = '';
  input.focus = () => {};
  const cancel = new EventTarget();
  const accept = { disabled: true, textContent: '' };
  const fields = new Map([
    ['clearDataDialog', dialog],
    ['clearDataForm', form],
    ['clearDataPhrase', input],
    ['clearDataAccept', accept],
    ['clearDataCancel', cancel],
    ['clearDataTitle', { textContent: '' }],
    ['clearDataDescription', { textContent: '' }],
    ['clearDataPrompt', { textContent: '' }],
  ]);
  const root = { getElementById: (id) => fields.get(id) };
  const opts = {
    title: 'Delete?',
    message: 'This cannot be undone.',
    prompt: 'Type DELETE',
    phrase: 'DELETE',
    confirmLabel: 'Delete all',
    cancelLabel: 'Cancel',
  };
  return { root, opts, dialog, form, input, cancel, accept, fields };
}

test('typed confirmation rejects wrong phrase and accepts an exact match', async () => {
  const { root, opts, dialog, form, input, accept, fields } = fixture();
  const pending = showTypedConfirm(opts, root);
  assert.equal(dialog.open, true);
  assert.equal(accept.disabled, true);
  assert.equal(
    fields.get('clearDataDescription').textContent,
    'This cannot be undone.',
  );
  input.value = 'delete';
  input.dispatchEvent(new Event('input'));
  assert.equal(accept.disabled, true);
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(dialog.open, true);
  input.value = 'DELETE';
  input.dispatchEvent(new Event('input'));
  assert.equal(accept.disabled, false);
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(await pending, true);
  assert.equal(dialog.open, false);
});

test('typed confirmation cancels on Escape, backdrop or Cancel', async () => {
  const { root, opts, dialog, cancel, input } = fixture();
  let pending = showTypedConfirm(opts, root);
  dialog.close('');
  assert.equal(await pending, false);
  pending = showTypedConfirm(opts, root);
  dialog.dispatchEvent(new Event('click'));
  assert.equal(await pending, false);
  pending = showTypedConfirm(opts, root);
  input.value = 'DELETE';
  input.dispatchEvent(new Event('input'));
  cancel.dispatchEvent(new Event('click'));
  assert.equal(await pending, false);
});

test('typed confirmation cannot be replaced or approved if modal fails', async () => {
  const { root, opts, dialog } = fixture();
  const first = showTypedConfirm(opts, root);
  assert.equal(await showTypedConfirm(opts, root), false);
  dialog.close('cancel');
  assert.equal(await first, false);
  dialog.showModal = () => {
    throw new Error('not available');
  };
  assert.equal(await showTypedConfirm(opts, root), false);
});
