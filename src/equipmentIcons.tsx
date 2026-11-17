import { assetUrl } from './lib/asset-url';
import { profileEquipmentCatalog } from './lib/equipment-catalog.ts';

export { profileEquipmentCatalog };

function illustration(item: string) {
  return function EquipmentIllustration() {
    return (
      <img
        className="equipment-icon"
        src={assetUrl(`icons/equipment/${item}.webp`)}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
      />
    );
  };
}

export const equipmentIcons = {
  jacket: illustration('jacket'),
  mask: illustration('mask'),
  pants: illustration('pants'),
  gloves: illustration('gloves'),
  gloves_heavy: illustration('gloves_heavy'),
  forearm: illustration('forearm'),
  knee: illustration('knee'),
  groin: illustration('groin'),
  overlay: illustration('overlay'),
  gorget: illustration('gorget'),
  sabre: illustration('sabre'),
  sword_buckler: illustration('sword_buckler'),
  longsword: illustration('longsword'),
};
