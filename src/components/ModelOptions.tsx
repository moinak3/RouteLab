import { modelFamilies } from "../core/catalog";
import { openRouterFamilyLabels } from "../core/openRouterModels";
import type { Model } from "../types";

export function ModelOptions({ models }: { models: Model[] }) {
  return <>{modelFamilies.map(family=>{const familyModels=models.filter(model=>model.family===family);return familyModels.length?<optgroup label={openRouterFamilyLabels[family]} key={family}>{familyModels.map(model=><option value={model.id} key={model.id}>{model.display_name}{model.openrouter_created_at ? ` · ${new Date(model.openrouter_created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ` · ${model.family_tier} · ${model.quality_tier}`}</option>)}</optgroup>:null})}</>;
}
