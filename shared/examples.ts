import { normalizeDesign, type Design } from './model.js';
import { FLOWER_SAMPLE } from './flower-sample.js';
import { ROCKET_SAMPLE } from './rocket-sample.js';
import { TREE_SAMPLE } from './tree-sample.js';
import { DUCK_SAMPLE } from './duck-sample.js';
import { BIRDHOUSE_SAMPLE } from './birdhouse-sample.js';
import { COMPLEX_SAMPLE } from './complex-sample.js';

export const SAMPLE_DESIGNS: Design[] = [FLOWER_SAMPLE, ROCKET_SAMPLE, TREE_SAMPLE, DUCK_SAMPLE, BIRDHOUSE_SAMPLE, COMPLEX_SAMPLE].map(normalizeDesign);
