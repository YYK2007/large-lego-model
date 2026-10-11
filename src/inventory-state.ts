import { resolveCatalog, type CatalogManifest, type InventoryItem } from '../shared/model';

export type CollectionSnapshot = { items: InventoryItem[]; catalog?: CatalogManifest };
type StorageReader = Pick<Storage, 'getItem'>;
export function readCollection(storage: StorageReader): CollectionSnapshot {
  try {
    const saved = JSON.parse(storage.getItem('sprout-collection') || 'null');
    const legacyDesign = saved ? undefined : JSON.parse(storage.getItem('sprout-design') || 'null');
    const snapshot: CollectionSnapshot = saved || { items: JSON.parse(storage.getItem('sprout-inventory') || '[]'), catalog: legacyDesign?.catalog };
    resolveCatalog(snapshot.catalog);
    if (!Array.isArray(snapshot.items) || snapshot.items.length > 500 || !snapshot.items.every(item => item && typeof item.partId === 'string'
      && Number.isInteger(item.colorId) && Number.isSafeInteger(item.quantity) && item.quantity >= 0 && typeof item.source === 'string' && item.source.length <= 120)) return { items: [] };
    return snapshot;
  } catch { return { items: [] }; }
}
export function saveCollection(storage: Pick<Storage, 'setItem'>, snapshot: CollectionSnapshot) {
  // One write keeps imported part definitions and quantities together on reload.
  storage.setItem('sprout-collection', JSON.stringify(snapshot));
}
