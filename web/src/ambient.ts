import Phaser from 'phaser';

// The town is one illustration: animate small foliage cutouts and pixel effects above it.
export class TownAmbient {
  private graphics:Phaser.GameObjects.Graphics;
  private foliage:{image:Phaser.GameObjects.Image;x:number;y:number;phase:number}[]=[];
  private patches:Phaser.GameObjects.Image[]=[];
  private steamBase?:Phaser.GameObjects.Image;
  private lights:{glow:Phaser.GameObjects.Image;glass?:Phaser.GameObjects.Image;phase:number}[]=[];
  private last=-1;
  constructor(private scene:Phaser.Scene,private npcs:Map<string,Phaser.GameObjects.Sprite>,private privateArt:boolean){
    this.graphics=scene.add.graphics().setDepth(1.2);
    const source=scene.textures.get('isometric-world').getSourceImage() as HTMLImageElement;
    this.patches.push(this.animateSource('hearth-fire',292,100,40,47),this.animateSource('cauldron-fire',359,202,46,14),this.animateSource('cauldron-steam',355,101,66,54,true));
    const glow=scene.textures.createCanvas('warm-light',64,80)!;
    for(let y=0;y<80;y+=2)for(let x=0;x<64;x+=2){const distance=Math.hypot((x-32)/32,(y-40)/40);if(distance<1){glow.context.fillStyle=`rgba(255,174,55,${.48*(1-distance)**1.6})`;glow.context.fillRect(x,y,2,2);}}
    glow.refresh();
    // Measured centres of the four lantern windows in the illustration.
    [[896,170],[1052,342],[513,608],[1318,556]].forEach(([x,y],i)=>{
      const key='lamp-glass-'+i,glass=scene.textures.createCanvas(key,26,34)!;
      glass.context.drawImage(source,x-13,y-17,26,34,0,0,26,34);
      const data=glass.context.getImageData(0,0,26,34);
      for(let p=0;p<data.data.length;p+=4){const [r,g,b]=data.data.slice(p,p+3);data.data[p+3]=r>170&&g>100&&b<210?255:0;data.data[p]=174;data.data[p+1]=73;data.data[p+2]=16;}
      glass.context.putImageData(data,0,0);glass.refresh();
      this.lights.push({glow:scene.add.image(x,y,'warm-light').setDepth(1.25).setVisible(false),glass:scene.add.image(x-13,y-17,key).setOrigin(0).setDepth(1.35).setVisible(false),phase:i*1.8});
    });
    for(const [x,y,scale] of [[311,133,1.5],[380,211,1]])this.lights.push({glow:scene.add.image(x,y,'warm-light').setScale(scale).setDepth(1.25).setVisible(false),phase:x});
    [[828,555,95,62],[620,734,110,70],[1007,714,120,80],[1350,50,120,90],[1445,150,110,90],[1290,115,95,90]].forEach(([x,y,w,h],index)=>{
      const key='wind-foliage-'+index,texture=scene.textures.createCanvas(key,w,h)!;
      texture.context.drawImage(source,x,y,w,h,0,0,w,h);
      const data=texture.context.getImageData(0,0,w,h);
      for(let p=0;p<data.data.length;p+=4){const [r,g,b]=data.data.slice(p,p+3),px=(p/4)%w,py=Math.floor(p/4/w);if(!(g>r*.9&&g>b*1.1&&g>70||r>150&&g>110&&b<r*.7||index<3&&b>r*1.1&&b>110)||px<3||px>w-4||py>h-8)data.data[p+3]=0;}
      texture.context.putImageData(data,0,0);texture.refresh();
      this.foliage.push({image:scene.add.image(x,y,key).setOrigin(0).setDepth(1.1),x,y,phase:index*1.7});
    });
    if(privateArt)for(const [id,sprite] of npcs){
      const original=sprite.texture.getSourceImage() as HTMLImageElement,texture=scene.textures.createCanvas('merchant-'+id+'-blink',128,128)!;
      texture.context.drawImage(original,0,0);
      for(const x of [56,68]){texture.context.fillStyle='#d08860';texture.context.fillRect(x,62,6,6);texture.context.fillStyle='#583c38';texture.context.fillRect(x,64,6,2);}
      texture.refresh();
    }
  }
  private animateSource(key:string,x:number,y:number,w:number,h:number,steam=false){
    const source=this.scene.textures.get('isometric-world').getSourceImage() as HTMLImageElement;
    const base=this.scene.textures.createCanvas(key+'-source',w,h)!;
    base.context.drawImage(source,x,y,w,h,0,0,w,h);
    const original=base.context.getImageData(0,0,w,h),mask=new Uint8Array(w*h);
    for(let i=0;i<mask.length;i++){
      const p=i*4,[r,g,b]=original.data.slice(p,p+3),px=x+i%w,py=y+Math.floor(i/w);
      mask[i]=Number(steam?(g>b+12&&(g>r+5||g>180&&g>=r-3)&&(py<146||px>=375&&px<=389)):(r>185&&g>75&&b<210&&(r>g*1.2||r>235&&g>180)));
    }
    const expanded=mask.slice();
    for(let i=0;i<mask.length;i++)if(mask[i])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const sx=i%w+dx,sy=Math.floor(i/w)+dy;if(sx>=0&&sx<w&&sy>=0&&sy<h)expanded[sy*w+sx]=1;}
    if(steam){
      // Replace only the baked steam with neighbouring wall colours; reduced motion restores the original illustration.
      const clean=base.context.createImageData(w,h);clean.data.set(original.data);
      for(let row=0;row<h;row++){
        let left=0,right=w-1;while(left<w&&!expanded[row*w+left])left++;while(right>=0&&!expanded[row*w+right])right--;
        if(left>right)continue;const a=(row*w+Math.max(0,left-3))*4,b=(row*w+Math.min(w-1,right+3))*4;
        for(let col=left;col<=right;col++)if(expanded[row*w+col]){const mix=(col-left)/Math.max(1,right-left),p=(row*w+col)*4;for(let c=0;c<3;c++)clean.data[p+c]=original.data[a+c]*(1-mix)+original.data[b+c]*mix;}
      }
      base.context.putImageData(clean,0,0);base.refresh();this.steamBase=this.scene.add.image(x,y,key+'-source').setOrigin(0).setDepth(.7).setVisible(false);
    }
    const texture=this.scene.textures.createCanvas(key,w*8,h)!;
    for(let frame=0;frame<8;frame++){
      const result=texture.context.createImageData(w,h);if(!steam)result.data.set(original.data);
      const phase=frame*Math.PI/4;
      for(let row=0;row<h;row++)for(let col=0;col<w;col++){
        const dx=Math.round(Math.sin(phase+row/7)*(steam?3:2)),dy=Math.round(Math.cos(phase+col/8)*(steam?2:3));
        const sx=Math.min(w-1,Math.max(0,col+dx)),sy=Math.min(h-1,Math.max(0,row+dy)),p=(row*w+col)*4,s=(sy*w+sx)*4;
        if(steam?mask[sy*w+sx]:expanded[row*w+col]){const brightness=steam?1:.94+.12*Math.sin(phase+col/5);for(let c=0;c<3;c++)result.data[p+c]=original.data[s+c]*brightness;result.data[p+3]=steam?230:255;}
      }
      texture.context.putImageData(result,frame*w,0);texture.add(String(frame),0,frame*w,0,w,h);
    }
    texture.refresh();return this.scene.add.image(x,y,key,'0').setOrigin(0).setDepth(1.3).setAlpha(steam?1:.5).setVisible(false);
  }
  update(time:number,reduced:boolean){
    const tick=Math.floor(time/125);if(tick===this.last)return;this.last=tick;
    this.graphics.clear();this.graphics.setVisible(!reduced);
    this.patches.forEach(image=>image.setVisible(!reduced).setFrame(String(tick%8)));
    this.steamBase?.setVisible(!reduced);
    this.lights.forEach(({glow,glass,phase})=>{const pulse=(Math.sin(time/850+phase)+Math.sin(time/1650+phase)*.4+1.4)/2.8;glow.setVisible(!reduced).setAlpha((.25+pulse*.75)*(glass?1:.3));glass?.setVisible(!reduced).setAlpha((1-pulse)*.42);});
    this.foliage.forEach(({image,x,y,phase})=>image.setVisible(!reduced).setPosition(x+Math.round(Math.sin(time/1100+phase)*1.5),y+Math.round(Math.sin(time/1700+phase)*.6)));
    if(this.privateArt){let index=0;for(const [id,sprite] of this.npcs){const key='merchant-'+id+(!reduced&&(time+index++*1500)%5400<180?'-blink':'');if(sprite.texture.key!==key)sprite.setTexture(key);}}
    if(reduced)return;
    const g=this.graphics,t=time/1000;
    // Small stepped highlights follow the spring's falling water and basin.
    for(let i=0;i<6;i++){g.fillStyle(i%2?0xb4e4d9:0x65bac4,.55);g.fillRect(974+(i%2)*3,322+(tick*3+i*7)%35,2,5);}
    for(let ring=0;ring<3;ring++){
      const radius=8+((t*9+ring*12)%34);g.lineStyle(1,0xc5ece0,.28);
      g.strokeEllipse(977,369,radius*2,radius*.55);
    }
    for(let i=0;i<6;i++){
      const rise=(t*17+i*14)%83,x=379+Math.round(Math.sin(t*.8+i)*4+rise*.28),y=153-rise,size=4+Math.floor(rise/15);
      g.fillStyle(0xcbdca0,(1-rise/83)*.3);g.fillRect(x+2,y,size,6);g.fillRect(x,y+2,size+4,2);
    }
    for(let i=0;i<10;i++){
      const x=1265+(t*13+i*29)%290,y=100+i*17+Math.sin(t+i)*12;
      g.fillStyle(i%2?0xb0bd54:0xd6cb6a,.4);g.fillRect(Math.round(x),Math.round(y),3,2);
    }
    this.scene.game.canvas.dataset.ambientFrame=String(tick);
  }
}
