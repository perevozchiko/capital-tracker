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
