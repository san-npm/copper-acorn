import type { Point } from './navigation';

// shortcut: scenery is static; update this mesh and the silhouettes when fixtures move in the artwork.

export const WORLD = { width: 1586, height: 992, spawn: [870, 760] as Point };
export const ACTOR = { frame: 128, feet: 124, height: 112, scale: 144 / 112, radius: 15 };
export type Spot = { id: string; label: string; kind: 'gather' | 'merchant' | 'shop' | 'cauldron' | 'arena'; target: string; at: Point; approach: Point; ground?: Point; radius: number };
export const spots: Spot[] = [
  { id: 'arena_portal', label: 'Portal · Arena of Eight', kind: 'arena', target: '', at: [880, 820], approach: [1010, 930], radius: 75 },
  { id: 'sunleaf', label: 'Sunleaf bed', kind: 'gather', target: 'sunleaf', at: [875, 600], approach: [887, 726], radius: 65 },
  { id: 'moonmint', label: 'Moonmint bed', kind: 'gather', target: 'moonmint', at: [675, 795], approach: [687, 918], radius: 65 },
  { id: 'emberbloom', label: 'Emberbloom bed', kind: 'gather', target: 'emberbloom', at: [1065, 770], approach: [1065, 890], radius: 65 },
  { id: 'spring_water', label: 'Spring water', kind: 'gather', target: 'spring_water', at: [975, 350], approach: [974, 439], radius: 55 },
  { id: 'wood_essence', label: 'Wood essence tap', kind: 'gather', target: 'wood_essence', at: [1432, 315], approach: [1370, 435], ground: [1435, 400], radius: 52 },
  { id: 'silver_dust', label: 'Silver-veined stone', kind: 'gather', target: 'silver_dust', at: [1380, 868], approach: [1250, 886], radius: 65 },
  { id: 'mira', label: 'Mira · herbalist', kind: 'merchant', target: 'mira', at: [385, 708], approach: [450, 810], radius: 64 },
  { id: 'rowan', label: 'Rowan · distiller', kind: 'merchant', target: 'rowan', at: [1180, 445], approach: [1150, 557], radius: 65 },
  { id: 'bram', label: 'Bram · alchemical supplies', kind: 'merchant', target: 'bram', at: [1395, 635], approach: [1390, 784], radius: 62 },
  { id: 'shelves', label: 'Your display cabinets', kind: 'shop', target: '', at: [656, 190], approach: [644, 332], radius: 90 },
  { id: 'cauldron', label: 'Brewing cauldron', kind: 'cauldron', target: '', at: [379, 195], approach: [446, 250], radius: 52 },
];

// Coordinates describe feet on the already projected floor; stairs join the two surfaces.
export const surfaces: Point[][] = [
  [[173, 295], [290, 235], [447, 217], [538, 248], [657, 278], [747, 321], [688, 361], [450, 482], [181, 412], [159, 379]],
  [[442, 475], [651, 384], [776, 506], [551, 583]],
  [[327, 798], [548, 571], [745, 480], [918, 414], [1030, 423], [1040, 499], [1300, 540], [1318, 421], [1457, 413], [1548, 442], [1564, 759], [1462, 802], [1240, 914], [883, 983], [610, 983], [403, 884]],
];
export const ARENA_GATE={feet:[880,938] as Point,width:240,height:255};
export const portalBase:Point[]=[[788,896],[880,870],[972,903],[880,941]];
export const solids: Point[][] = [
  [[306, 356], [531, 282], [592, 305], [592, 340], [400, 424], [307, 388]], // shop counter
  [[190, 291], [245, 263], [281, 288], [260, 328], [217, 325]], // work stool
  [[744, 635], [877, 565], [1008, 638], [876, 711]],
  [[546, 815], [684, 746], [823, 828], [673, 901]],
  [[929, 796], [1065, 728], [1197, 803], [1067, 869]],
  [[1300, 390], [1430, 322], [1583, 387], [1468, 452]],
  [[1017, 457], [1094, 416], [1304, 482], [1303, 529], [1225, 543], [1042, 487]],
  [[1236, 633], [1375, 600], [1514, 663], [1510, 727], [1440, 765], [1254, 684]],
  [[214, 712], [337, 659], [511, 693], [517, 762], [348, 811], [252, 778]],
];

export type Occluder = { name: string; outline: Point[]; front: [Point, Point] };
export const occluders: Occluder[] = [
  { name: 'shop-counter', outline: [[306, 314], [343, 282], [386, 278], [433, 250], [461, 255], [495, 232], [547, 249], [592, 268], [592, 338], [401, 422], [309, 383]], front: [[400, 422], [592, 338]] },
  { name: 'mira-counter', outline: [[269, 708], [331, 669], [478, 648], [510, 677], [510, 751], [350, 811], [270, 768]], front: [[270, 768], [510, 751]] },
  { name: 'rowan-counter', outline: [[1055, 421], [1090, 401], [1294, 466], [1300, 508], [1228, 533], [1055, 472]], front: [[1055, 472], [1228, 533]] },
  { name: 'bram-counter', outline: [[1260, 635], [1378, 602], [1504, 656], [1501, 706], [1441, 751], [1262, 675]], front: [[1262, 675], [1441, 751]] },
  { name: 'mira-awning', outline: [[202, 551], [410, 503], [498, 548], [484, 591], [354, 633], [217, 595]], front: [[270, 768], [510, 751]] },
  { name: 'rowan-awning', outline: [[1074, 288], [1124, 254], [1310, 305], [1302, 346], [1227, 371], [1067, 320]], front: [[1055, 472], [1228, 533]] },
  { name: 'bram-awning', outline: [[1292, 493], [1326, 452], [1424, 445], [1577, 500], [1564, 548], [1452, 575], [1291, 529]], front: [[1262, 675], [1441, 751]] },
  { name: 'sunleaf-bed', outline: [[747, 631], [782, 573], [872, 538], [937, 566], [1008, 637], [877, 712]], front: [[747, 645], [877, 712]] },
  { name: 'moonmint-bed', outline: [[550, 815], [589, 746], [660, 712], [755, 753], [823, 827], [673, 901]], front: [[550, 831], [673, 901]] },
  { name: 'emberbloom-bed', outline: [[930, 798], [979, 725], [1069, 679], [1157, 735], [1199, 802], [1067, 869]], front: [[930, 805], [1067, 869]] },
];
export const merchants = [
  { id: 'mira', feet: [378, 739] as Point }, { id: 'rowan', feet: [1187, 477] as Point }, { id: 'bram', feet: [1398, 704] as Point },
];
// Each cabinet is a sale slot; visible bottles fill three rows, up to nine owned units.
export const displays: Point[][] = [
  [[577, 174], [605, 182], [629, 189], [577, 132], [605, 140], [629, 147], [577, 216], [605, 224], [629, 231]],
  [[704, 214], [731, 222], [757, 230], [704, 173], [731, 181], [757, 189], [704, 255], [731, 263], [757, 271]],
];
