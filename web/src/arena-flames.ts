import {arenaAsset} from './arena-art';

export async function warmArenaFlames(scenery:HTMLElement){
  const source=new Image();source.src=arenaAsset('arena-map-night.png');await source.decode();
  for(const [i,element] of [...scenery.querySelectorAll<HTMLElement>('.arena-flame')].entries()){
    const width=66,height=90,frames=12,canvas=document.createElement('canvas');canvas.width=width*frames;canvas.height=height;
    const context=canvas.getContext('2d')!;context.drawImage(source,i?1402:65,75,width,height,0,0,width,height);
    const original=context.getImageData(0,0,width,height);context.clearRect(0,0,canvas.width,canvas.height);
    for(let frame=0;frame<frames;frame++){
      const pixels=context.createImageData(width,height),phase=frame*Math.PI*2/frames;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const rise=1-y/height,sx=x+Math.round(Math.sin(phase+y*.14)*rise*4),sy=y+Math.round(Math.cos(phase+x*.18)*rise*3);
        if(sx<0||sx>=width||sy<0||sy>=height)continue;
        const p=(sy*width+sx)*4,r=original.data[p],g=original.data[p+1],b=original.data[p+2];
        if(!(r>185&&g>75&&b<150&&r>g*1.15||r>235&&g>185&&b<245))continue;
        const target=(y*width+x)*4,light=.96+.04*Math.sin(phase+y*.12);
        pixels.data[target]=r*light;pixels.data[target+1]=g*light;pixels.data[target+2]=b;pixels.data[target+3]=255;
      }
      context.putImageData(pixels,frame*width,0);
    }
    element.style.backgroundImage=`url('${canvas.toDataURL()}')`;element.dataset.frames=String(frames);
  }
}
