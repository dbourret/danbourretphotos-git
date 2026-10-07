"use strict";
const fields={song:"Song",artist:"Artist",album:"Album",directory:"Directory",filename:"Filename",parent_folder:"Parent folder",full_path:"Full path",track_number:"Track number",file_type:"File type",parse_method:"Parse method",parse_confidence:"Parse confidence",import_id:"Import ID"};
const $=id=>document.getElementById(id);
Object.entries(fields).forEach(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;$('field').append(o)});
let state=null,controller=null;
const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=String(value??'');if(cls)el.className=cls;return el};
function render(data){
 $('rows').replaceChildren();
 for(const row of data.rows){
  const tr=document.createElement('tr');
  const title=text('td',row.song||row.filename||'Untitled');if(row.song&&row.filename)title.append(text('small',row.filename));tr.append(title);
  tr.append(text('td',row.artist||'—'),text('td',row.album||'—'));
  const type=document.createElement('td');type.append(text('span',(row.file_type||'—').toUpperCase(),'badge'));tr.append(type);
  const td=document.createElement('td'),details=document.createElement('details'),dl=document.createElement('dl');details.append(text('summary','View file details'));
  for(const key of ['import_id','directory','parent_folder','full_path','track_number','parse_method','parse_confidence']){dl.append(text('dt',fields[key]),text('dd',row[key]??'—'));}details.append(dl);td.append(details);tr.append(td);$('rows').append(tr);
 }
 $('empty').hidden=data.total>0;if(!data.total){$('empty').replaceChildren(text('div','No matching tracks'),text('small','Try a shorter phrase or choose a different column.'));}
 $('table-wrap').hidden=data.total===0;$('pagination').hidden=data.total===0;
 $('status').textContent=`${data.total.toLocaleString()} matches · ${fields[state.field]} contains “${state.q}”`;
 $('page-label').textContent=`Page ${data.page} of ${data.pages.toLocaleString()}`;
 $('prev').disabled=data.page<=1;$('next').disabled=data.page>=data.pages;state.page=data.page;
}
async function search(page=1){
 if(controller)controller.abort();controller=new AbortController();const active=controller;
 $('error').hidden=true;$('submit').disabled=true;$('prev').disabled=true;$('next').disabled=true;$('status').textContent='Searching your collection…';$('table-wrap').hidden=true;$('empty').hidden=true;$('pagination').hidden=true;
 try{
  let data;
  if(window.MUSIC_DEMO){const matches=window.MUSIC_DEMO.filter(r=>String(r[state.field]??'').toLowerCase().includes(state.q.toLowerCase()));const pages=Math.max(1,Math.ceil(matches.length/50));page=Math.min(page,pages);data={rows:matches.slice((page-1)*50,page*50),total:matches.length,page,pages};}
  else{const params=new URLSearchParams({field:state.field,q:state.q,page:String(page)});const response=await fetch('search.php?'+params,{signal:active.signal});data=await response.json();if(!response.ok)throw new Error(data.error||'Search failed.');}
  render(data);
 }catch(e){if(e.name!=='AbortError'){$('error').textContent=e.message;$('error').hidden=false;$('status').textContent='Search could not be completed';}}
 finally{if(controller===active)$('submit').disabled=false;}
}
$('search-form').addEventListener('submit',e=>{e.preventDefault();const q=$('q').value.trim();if(!q){$('q').focus();return;}state={field:$('field').value,q,page:1};search()});
$('prev').addEventListener('click',()=>search(state.page-1));$('next').addEventListener('click',()=>search(state.page+1));
