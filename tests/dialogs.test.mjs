import test from 'node:test';
import assert from 'node:assert/strict';
import { showConfirm } from '../web/js/dialogs.js';

function fixture() {
  const classList=()=>({classes:new Set(),toggle(key,on){if(on)this.classes.add(key);else this.classes.delete(key)}});
  const fields=new Map(['confirmTitle','confirmMessage','confirmCancel','confirmAccept'].map(id=>[id,{textContent:'',classList:classList()}]));
  const dialog=new EventTarget();
  dialog.open=false;
  dialog.returnValue='';
  dialog.classList=classList();
  dialog.showModal=()=>{dialog.open=true};
  dialog.close=value=>{dialog.returnValue=value;dialog.open=false;dialog.dispatchEvent(new Event('close'))};
  const root={getElementById(id){return id==='confirmDialog'?dialog:fields.get(id)}};
  return {dialog,fields,root};
}

test('confirmation is styled and approves only an explicit confirm',async()=>{
  const {dialog,fields,root}=fixture();
  const pending=showConfirm({title:'Delete?',message:'<script>not markup</script>',confirmLabel:'Delete',cancelLabel:'Cancel',danger:true},root);
  assert.equal(dialog.open,true);
  assert.equal(fields.get('confirmMessage').textContent,'<script>not markup</script>');
  assert.equal(fields.get('confirmAccept').classList.classes.has('btn-danger-solid'),true);
  dialog.close('confirm');
  assert.equal(await pending,true);
});
test('Escape and backdrop cancel safely',async()=>{
  const {dialog,root}=fixture();
  const opts={title:'Delete?',message:'Really?',confirmLabel:'Delete',cancelLabel:'Cancel',danger:true};
  let pending=showConfirm(opts,root);
  dialog.close('');
  assert.equal(await pending,false);
  pending=showConfirm(opts,root);
  dialog.dispatchEvent(new Event('click'));
  assert.equal(await pending,false);
});
test('a second confirmation cannot override the first',async()=>{
  const {dialog,root}=fixture();
  const opts={title:'Confirm',message:'Details',confirmLabel:'OK',cancelLabel:'Cancel'};
  const first=showConfirm(opts,root);
  assert.equal(await showConfirm(opts,root),false);
  dialog.close('cancel');
  assert.equal(await first,false);
});
test('showModal failures never grant permission',async()=>{
  const {dialog,root}=fixture();
  dialog.showModal=()=>{throw new Error('blocked')};
  assert.equal(await showConfirm({title:'Confirm',message:'Details',confirmLabel:'OK',cancelLabel:'Cancel'},root),false);
});
