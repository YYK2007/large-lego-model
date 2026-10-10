import type { ShapePlanV2 } from '../../server/compiler.js';

// Recorded AI geometry only; no reference payloads, credentials, or subject fallback.
// Full-brick courses strand headers; one-plate courses preserve the exact shape.
export const TAJ_PLATE_PACKING_PLAN: ShapePlanV2 = {
  schemaVersion: 2,
  coordinateSystem: "stud-xy-plate-z",
  title: "Taj Mahal Mausoleum Complex",
  description: "A detailed model of the Taj Mahal in Agra, featuring the expansive square plinth, the central tomb chamber with chamfered corners, four monumental arched iwans, tiered side arches, four corner chattri kiosks, four freestanding corner minarets with balconies and pavilions, and the central onion-domed drum crowned with a golden finial.",
  boxes: [
    {"x":8,"y":8,"z":0,"width":80,"depth":80,"height":6,"colorId":19},
    {"x":10,"y":10,"z":6,"width":76,"depth":76,"height":6,"colorId":15},
    {"x":24,"y":24,"z":12,"width":48,"depth":48,"height":33,"colorId":15,"cutouts":[{"x":6,"y":6,"z":0,"width":36,"depth":36,"height":33},{"x":0,"y":0,"z":0,"width":6,"depth":6,"height":33},{"x":42,"y":0,"z":0,"width":6,"depth":6,"height":33},{"x":0,"y":42,"z":0,"width":6,"depth":6,"height":33},{"x":42,"y":42,"z":0,"width":6,"depth":6,"height":33},{"x":16,"y":0,"z":0,"width":16,"depth":5,"height":27},{"x":16,"y":43,"z":0,"width":16,"depth":5,"height":27},{"x":0,"y":16,"z":0,"width":5,"depth":16,"height":27},{"x":43,"y":16,"z":0,"width":5,"depth":16,"height":27},{"x":8,"y":0,"z":3,"width":6,"depth":3,"height":10},{"x":34,"y":0,"z":3,"width":6,"depth":3,"height":10},{"x":8,"y":0,"z":16,"width":6,"depth":3,"height":10},{"x":34,"y":0,"z":16,"width":6,"depth":3,"height":10},{"x":8,"y":45,"z":3,"width":6,"depth":3,"height":10},{"x":34,"y":45,"z":3,"width":6,"depth":3,"height":10},{"x":8,"y":45,"z":16,"width":6,"depth":3,"height":10},{"x":34,"y":45,"z":16,"width":6,"depth":3,"height":10},{"x":0,"y":8,"z":3,"width":3,"depth":6,"height":10},{"x":0,"y":34,"z":3,"width":3,"depth":6,"height":10},{"x":0,"y":8,"z":16,"width":3,"depth":6,"height":10},{"x":0,"y":34,"z":16,"width":3,"depth":6,"height":10},{"x":45,"y":8,"z":3,"width":3,"depth":6,"height":10},{"x":45,"y":34,"z":3,"width":3,"depth":6,"height":10},{"x":45,"y":8,"z":16,"width":3,"depth":6,"height":10},{"x":45,"y":34,"z":16,"width":3,"depth":6,"height":10}]},
    {"x":38,"y":38,"z":12,"width":20,"depth":20,"height":33,"colorId":15},
    {"x":23,"y":23,"z":45,"width":50,"depth":50,"height":3,"colorId":15,"cutouts":[{"x":0,"y":0,"z":0,"width":5,"depth":5,"height":3},{"x":45,"y":0,"z":0,"width":5,"depth":5,"height":3},{"x":0,"y":45,"z":0,"width":5,"depth":5,"height":3},{"x":45,"y":45,"z":0,"width":5,"depth":5,"height":3}]},
    {"x":38,"y":38,"z":48,"width":20,"depth":20,"height":12,"colorId":15,"cutouts":[{"x":0,"y":0,"z":0,"width":3,"depth":3,"height":12},{"x":17,"y":0,"z":0,"width":3,"depth":3,"height":12},{"x":0,"y":17,"z":0,"width":3,"depth":3,"height":12},{"x":17,"y":17,"z":0,"width":3,"depth":3,"height":12}]},
    {"x":36,"y":36,"z":60,"width":24,"depth":24,"height":6,"colorId":15,"cutouts":[{"x":0,"y":0,"z":0,"width":4,"depth":4,"height":6},{"x":20,"y":0,"z":0,"width":4,"depth":4,"height":6},{"x":0,"y":20,"z":0,"width":4,"depth":4,"height":6},{"x":20,"y":20,"z":0,"width":4,"depth":4,"height":6}]},
    {"x":38,"y":38,"z":66,"width":20,"depth":20,"height":6,"colorId":15,"cutouts":[{"x":0,"y":0,"z":0,"width":3,"depth":3,"height":6},{"x":17,"y":0,"z":0,"width":3,"depth":3,"height":6},{"x":0,"y":17,"z":0,"width":3,"depth":3,"height":6},{"x":17,"y":17,"z":0,"width":3,"depth":3,"height":6}]},
    {"x":41,"y":41,"z":72,"width":14,"depth":14,"height":6,"colorId":15,"cutouts":[{"x":0,"y":0,"z":0,"width":2,"depth":2,"height":6},{"x":12,"y":0,"z":0,"width":2,"depth":2,"height":6},{"x":0,"y":12,"z":0,"width":2,"depth":2,"height":6},{"x":12,"y":12,"z":0,"width":2,"depth":2,"height":6}]},
    {"x":44,"y":44,"z":78,"width":8,"depth":8,"height":3,"colorId":15},
    {"x":46,"y":46,"z":81,"width":4,"depth":4,"height":3,"colorId":15},
    {"x":47,"y":47,"z":84,"width":2,"depth":2,"height":6,"colorId":14},
  ],
  slopes: [

  ],
  parts: [
    {"partId":"4589","x":47,"y":47,"z":90,"colorId":14,"rotation":0},
    {"partId":"4589","x":48,"y":47,"z":90,"colorId":14,"rotation":0},
    {"partId":"4589","x":47,"y":48,"z":90,"colorId":14,"rotation":0},
    {"partId":"4589","x":48,"y":48,"z":90,"colorId":14,"rotation":0},
  ],
  repeats: [
    {"boxes":[{"x":28,"y":28,"z":48,"width":6,"depth":6,"height":1,"colorId":15},{"x":28,"y":28,"z":49,"width":1,"depth":1,"height":6,"colorId":15},{"x":33,"y":28,"z":49,"width":1,"depth":1,"height":6,"colorId":15},{"x":28,"y":33,"z":49,"width":1,"depth":1,"height":6,"colorId":15},{"x":33,"y":33,"z":49,"width":1,"depth":1,"height":6,"colorId":15},{"x":27,"y":27,"z":55,"width":8,"depth":8,"height":2,"colorId":15},{"x":29,"y":29,"z":57,"width":4,"depth":4,"height":3,"colorId":15},{"x":30,"y":30,"z":60,"width":2,"depth":2,"height":2,"colorId":14}],"slopes":[],"parts":[],"count":2,"dx":34,"dy":0,"dz":0},
    {"boxes":[{"x":28,"y":62,"z":48,"width":6,"depth":6,"height":1,"colorId":15},{"x":28,"y":62,"z":49,"width":1,"depth":1,"height":6,"colorId":15},{"x":33,"y":62,"z":49,"width":1,"depth":1,"height":6,"colorId":15},{"x":28,"y":67,"z":49,"width":1,"depth":1,"height":6,"colorId":15},{"x":33,"y":67,"z":49,"width":1,"depth":1,"height":6,"colorId":15},{"x":27,"y":61,"z":55,"width":8,"depth":8,"height":2,"colorId":15},{"x":29,"y":63,"z":57,"width":4,"depth":4,"height":3,"colorId":15},{"x":30,"y":64,"z":60,"width":2,"depth":2,"height":2,"colorId":14}],"slopes":[],"parts":[],"count":2,"dx":34,"dy":0,"dz":0},
    {"boxes":[{"x":12,"y":12,"z":12,"width":8,"depth":8,"height":3,"colorId":15},{"x":13,"y":13,"z":15,"width":6,"depth":6,"height":18,"colorId":15},{"x":12,"y":12,"z":33,"width":8,"depth":8,"height":2,"colorId":15},{"x":14,"y":14,"z":35,"width":4,"depth":4,"height":18,"colorId":15},{"x":13,"y":13,"z":53,"width":6,"depth":6,"height":2,"colorId":15},{"x":14,"y":14,"z":55,"width":4,"depth":4,"height":15,"colorId":15},{"x":13,"y":13,"z":70,"width":6,"depth":6,"height":2,"colorId":15},{"x":14,"y":14,"z":72,"width":4,"depth":4,"height":6,"colorId":15,"cutouts":[{"x":1,"y":1,"z":0,"width":2,"depth":2,"height":6}]},{"x":13,"y":13,"z":78,"width":6,"depth":6,"height":2,"colorId":15},{"x":14,"y":14,"z":80,"width":4,"depth":4,"height":3,"colorId":15},{"x":15,"y":15,"z":83,"width":2,"depth":2,"height":3,"colorId":14}],"slopes":[],"parts":[{"partId":"4589","x":15,"y":15,"z":86,"colorId":14,"rotation":0}],"count":2,"dx":64,"dy":0,"dz":0},
    {"boxes":[{"x":12,"y":76,"z":12,"width":8,"depth":8,"height":3,"colorId":15},{"x":13,"y":77,"z":15,"width":6,"depth":6,"height":18,"colorId":15},{"x":12,"y":76,"z":33,"width":8,"depth":8,"height":2,"colorId":15},{"x":14,"y":78,"z":35,"width":4,"depth":4,"height":18,"colorId":15},{"x":13,"y":77,"z":53,"width":6,"depth":6,"height":2,"colorId":15},{"x":14,"y":78,"z":55,"width":4,"depth":4,"height":15,"colorId":15},{"x":13,"y":77,"z":70,"width":6,"depth":6,"height":2,"colorId":15},{"x":14,"y":78,"z":72,"width":4,"depth":4,"height":6,"colorId":15,"cutouts":[{"x":1,"y":1,"z":0,"width":2,"depth":2,"height":6}]},{"x":13,"y":77,"z":78,"width":6,"depth":6,"height":2,"colorId":15},{"x":14,"y":78,"z":80,"width":4,"depth":4,"height":3,"colorId":15},{"x":15,"y":79,"z":83,"width":2,"depth":2,"height":3,"colorId":14}],"slopes":[],"parts":[{"partId":"4589","x":15,"y":79,"z":86,"colorId":14,"rotation":0}],"count":2,"dx":64,"dy":0,"dz":0},
  ],
};
