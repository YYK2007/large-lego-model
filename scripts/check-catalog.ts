import { expandFullCatalog, resolveGenerationCatalog } from '../server/catalog-resolver.js';
import { resolveCatalog } from '../shared/model.js';

// No credentials or API response headers are logged. Cache files stay in data/.
const args = process.argv.slice(2);
const value = (flag: string, fallback: string) => {
  const index = args.indexOf(flag); return index < 0 ? fallback : args[index + 1] || fallback;
};
const budgetMs = Number(value('--budget-ms', '45000'));
const limit = Number(value('--limit', '48'));
if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
  throw new Error('Use a positive integer --budget-ms and --limit between 1 and 500.');
}
if (args.includes('--all')) {
  console.log(JSON.stringify(await expandFullCatalog({ budgetMs, restart: args.includes('--restart'), refresh: args.includes('--refresh') }), null, 2));
  process.exit(0);
}
const query = value('--query', 'Plate|Slope Curved|Slope 30|Slope 45|Wedge Plate|Brick Arch|Round|Plant Leaf|Plant Flower');
const partIds = value('--parts', '').split(',').map(id => id.trim()).filter(Boolean);
const started = performance.now();
const result = await resolveGenerationCatalog({ query: '', queries: query.split('|').filter(Boolean), partIds, limit, budgetMs });
const catalog = resolveCatalog(result.catalog);
console.log(JSON.stringify({
  elapsedMs: Math.round(performance.now() - started),
  usableParts: Object.keys(catalog.parts).length,
  importedParts: Object.keys(result.catalog.parts).length,
  mappedNontransparentColors: Object.keys(catalog.colors).length,
  candidatesExamined: result.discovered.length,
  supported: result.discovered.filter(row => row.status === 'assembly-supported').length,
  unsupported: result.discovered.filter(row => row.status === 'unsupported').map(({ partId, name, reason }) => ({ partId, name, reason })),
  pending: result.discovered.filter(row => row.status === 'discovered').length,
  warnings: result.warnings,
}, null, 2));
