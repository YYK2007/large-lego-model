import type { ShapePlanV2 } from '../../server/compiler.js';

// Exact first live Bell Tower response: deliberately invalid, not a fallback model.
// Narrow plates make its clock details tileable, revealing their original support gap.
export const REJECTED_BELL_TOWER_PLAN: ShapePlanV2 = {
  schemaVersion: 2,
  coordinateSystem: "stud-xy-plate-z",
  title: "Morehead Bell Tower at UNC Chapel Hill",
  description: "A Lego model of the iconic Morehead-Patterson Bell Tower at UNC Chapel Hill. Features a wide stone plinth and stepped foundation terrace, a massive square brick base, an arched belfry tier with open sound arches and pilasters, a projecting molded cornice, an upper stepped lantern with clock faces, and a pyramidal belfry roof spire.",
  boxes: [
    {"x":2,"y":2,"z":0,"width":20,"depth":20,"height":6,"colorId":71},
    {"x":4,"y":4,"z":6,"width":16,"depth":16,"height":3,"colorId":71},
    {"x":6,"y":6,"z":9,"width":12,"depth":12,"height":3,"colorId":71},
    {"x":7,"y":7,"z":12,"width":10,"depth":10,"height":24,"colorId":70,"cutouts":[{"x":2,"y":2,"z":0,"width":6,"depth":6,"height":24},{"x":4,"y":0,"z":0,"width":2,"depth":2,"height":9}]},
    {"x":11,"y":11,"z":12,"width":2,"depth":2,"height":24,"colorId":70},
    {"x":6,"y":6,"z":36,"width":12,"depth":12,"height":3,"colorId":71},
    {"x":7,"y":7,"z":39,"width":10,"depth":10,"height":18,"colorId":70,"cutouts":[{"x":2,"y":2,"z":0,"width":6,"depth":6,"height":18},{"x":3,"y":0,"z":3,"width":4,"depth":2,"height":12},{"x":3,"y":8,"z":3,"width":4,"depth":2,"height":12},{"x":0,"y":3,"z":3,"width":2,"depth":4,"height":12},{"x":8,"y":3,"z":3,"width":2,"depth":4,"height":12}]},
    {"x":11,"y":11,"z":39,"width":2,"depth":2,"height":18,"colorId":70},
    {"x":6,"y":6,"z":57,"width":12,"depth":12,"height":3,"colorId":71},
    {"x":7,"y":7,"z":60,"width":10,"depth":10,"height":6,"colorId":71,"cutouts":[{"x":2,"y":2,"z":0,"width":6,"depth":6,"height":6}]},
    {"x":11,"y":11,"z":60,"width":2,"depth":2,"height":6,"colorId":71},
    {"x":11,"y":6,"z":61,"width":2,"depth":1,"height":4,"colorId":15},
    {"x":11,"y":17,"z":61,"width":2,"depth":1,"height":4,"colorId":15},
    {"x":6,"y":11,"z":61,"width":1,"depth":2,"height":4,"colorId":15},
    {"x":17,"y":11,"z":61,"width":1,"depth":2,"height":4,"colorId":15},
    {"x":8,"y":8,"z":66,"width":8,"depth":8,"height":3,"colorId":71},
    {"x":10,"y":10,"z":69,"width":4,"depth":4,"height":3,"colorId":71},
  ],
  slopes: [
    {"kind":"upright45","x":8,"y":8,"z":69,"width":8,"colorId":70,"rotation":0},
    {"kind":"upright45","x":8,"y":14,"z":69,"width":8,"colorId":70,"rotation":180},
  ],
};
