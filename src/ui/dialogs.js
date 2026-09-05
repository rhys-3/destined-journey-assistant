import { onCancel } from '../platform/lifecycle.js';
export const DIALOG_STYLES = `
.dj-dialog-backdrop{position:fixed;inset:0;background:var(--overlay);display:flex;align-items:center;justify-content:center;padding:16px;z-index:2147483645;box-sizing:border-box}
.dj-dialog{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:16px;padding:20px;width:min(720px,100%);max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box}
.dj-dialog h3{margin:0 0 12px}.dj-dialog-message{white-space:pre-wrap;overflow-wrap:anywhere;max-height:30dvh;overflow:auto;line-height:1.6}
.dj-dialog textarea{box-sizing:border-box;width:100%;min-height:100px;max-height:45dvh;padding:12px;margin:14px 0;background:var(--input);color:var(--ink);border:1px solid var(--line);border-radius:8px;resize:vertical}
.dj-dialog-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px}.dj-dialog-actions button{padding:10px 16px;background:var(--soft);border:1px solid var(--line);color:var(--ink);border-radius:8px}.dj-dialog-actions button:first-child{background:var(--selected);color:var(--gold)}
`;
export function createDialogs({ getRoot, open }) {
  const pending=new Set();
  function show({title='总结',message='',value,rows=12,choices,cancelValue=null}) {
    open(); const root=getRoot();
    return new Promise(resolve=>{
      const doc=root.ownerDocument,backdrop=doc.createElement('div'); backdrop.className='dj-dialog-backdrop';
      const dialog=doc.createElement('section');dialog.className='dj-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',title);
      const heading=doc.createElement('h3');heading.textContent=title;
      const body=doc.createElement('div');body.className='dj-dialog-message';
      // Existing summary callers escape names; decode text without inserting HTML.
      const decoder=doc.createElement('textarea');decoder.innerHTML=message;body.textContent=decoder.value;
      dialog.append(heading,body); let input;
      if(value!==undefined){input=doc.createElement('textarea');input.value=value;input.rows=rows;input.setAttribute('aria-label',title+'内容');dialog.append(input);}
      const actions=doc.createElement('div');actions.className='dj-dialog-actions';dialog.append(actions);backdrop.append(dialog);
      const previous=root.activeElement;let finished=false;let off=()=>{};
      function finish(result){if(finished)return;finished=true;backdrop.remove();pending.delete(cancel);off();previous?.focus?.({preventScroll:true});resolve(result);}
      const cancel=()=>finish(cancelValue);pending.add(cancel);off=onCancel(cancel);
      for(const [label,result] of choices){const button=doc.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>finish(result==='__input__'?input.value:result);actions.append(button);}
      backdrop.onclick=e=>{if(e.target===backdrop)cancel();};
      backdrop.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();cancel();}if(e.key==='Tab'){const fields=[...dialog.querySelectorAll('button,textarea')];const first=fields[0],last=fields.at(-1);if(e.shiftKey&&root.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&root.activeElement===last){e.preventDefault();first.focus();}}};
      root.querySelector('.destined-root').append(backdrop);(input??actions.firstChild).focus();
    });
  }
  return {
    popup(message,type,value,options={}) {
      const st=globalThis.SillyTavern;
      const input=type===st.POPUP_TYPE.INPUT;
      return show({message,title:input?'编辑与确认':'确认操作',value:input?(value??''):undefined,rows:options.rows??12,choices:[[options.okButton??'确定',input?'__input__':st.POPUP_RESULT.AFFIRMATIVE],[options.cancelButton??'取消',null]]});
    },
    chooseFailure({title,message,retryLabel='重新总结',reviewLabel='手动编辑',cancelLabel='取消'}) {return show({title,message,cancelValue:'cancel',choices:[[retryLabel,'retry'],[reviewLabel,'review'],[cancelLabel,'cancel']]});},
    destroy(){for(const cancel of [...pending])cancel();},
  };
}
