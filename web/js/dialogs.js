// In-app replacement for native confirm() with accessible, styled HTML <dialog>.
export function showConfirm({title,message,confirmLabel,cancelLabel,danger=false}, root=document) {
  const dialog=root.getElementById('confirmDialog');
  // A second action must never supersede an unanswered confirmation.
  if(dialog.open)return Promise.resolve(false);

  root.getElementById('confirmTitle').textContent=title;
  root.getElementById('confirmMessage').textContent=message;
  root.getElementById('confirmCancel').textContent=cancelLabel;
  const accept=root.getElementById('confirmAccept');
  accept.textContent=confirmLabel;
  accept.classList.toggle('btn-danger-solid',danger);
  dialog.classList.toggle('is-danger',danger);
  dialog.returnValue='cancel';

  return new Promise(resolve=>{
    const onBackdrop=event=>{if(event.target===dialog)dialog.close('cancel')};
    const onClose=()=>{
      dialog.removeEventListener('click',onBackdrop);
      resolve(dialog.returnValue==='confirm');
    };
    dialog.addEventListener('close',onClose,{once:true});
    dialog.addEventListener('click',onBackdrop);
    try{dialog.showModal()}catch{
      dialog.removeEventListener('close',onClose);
      dialog.removeEventListener('click',onBackdrop);
      resolve(false); // Fail closed if modal cannot be displayed.
    }
  });
}


// A destructive operation must be explicitly typed, not only clicked.
// All dynamic strings are assigned using textContent.
export function showTypedConfirm({title,message,prompt,phrase,confirmLabel,cancelLabel},root=document){
  const dialog=root.getElementById('clearDataDialog');
  if(dialog.open)return Promise.resolve(false);
  const input=root.getElementById('clearDataPhrase');
  const form=root.getElementById('clearDataForm');
  const accept=root.getElementById('clearDataAccept');
  const cancel=root.getElementById('clearDataCancel');
  root.getElementById('clearDataTitle').textContent=title;
  root.getElementById('clearDataDescription').textContent=message;
  root.getElementById('clearDataPrompt').textContent=prompt;
  accept.textContent=confirmLabel;
  cancel.textContent=cancelLabel;
  input.value='';
  accept.disabled=true;
  dialog.returnValue='cancel';
  return new Promise(resolve=>{
    const sync=()=>{accept.disabled=input.value!==phrase;};
    const onSubmit=e=>{
      e.preventDefault();
      if(input.value===phrase)dialog.close('confirm');
    };
    const onCancel=()=>dialog.close('cancel');
    const onBackdrop=e=>{if(e.target===dialog)dialog.close('cancel');};
    const onClose=()=>{
      input.removeEventListener('input',sync);
      form.removeEventListener('submit',onSubmit);
      cancel.removeEventListener('click',onCancel);
      dialog.removeEventListener('click',onBackdrop);
      resolve(dialog.returnValue==='confirm'&&input.value===phrase);
    };
    input.addEventListener('input',sync);
    form.addEventListener('submit',onSubmit);
    cancel.addEventListener('click',onCancel);
    dialog.addEventListener('click',onBackdrop);
    dialog.addEventListener('close',onClose,{once:true});
    try{
      dialog.showModal();
      input.focus();
    }catch{
      dialog.removeEventListener('close',onClose);
      onClose();
    }
  });
}
