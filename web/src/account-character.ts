export async function saveAccountCharacter(url:string,key:string,token:string,owner:string,id:string,current:()=>boolean){
  if(!['goblin','magician','dwarf','skeleton','lizard','vampire','elf','dark-elf'].includes(id))throw Error('Choose an available character.');
  if(!current())throw Error('Your account changed.');
  // Keep the original account's token even if another account signs in during this write.
  const response=await fetch(url+'/auth/v1/user',{method:'PUT',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({data:{character_id:id}}),redirect:'error',signal:AbortSignal.timeout(10_000)});
  const result=await response.json(),user=result?.user||result;
  if(!current())throw Error('Your account changed.');
  if(!response.ok||user?.id!==owner||user?.user_metadata?.character_id!==id)throw Error('Your character could not be saved.');
}
