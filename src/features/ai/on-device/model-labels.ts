export interface ParsedPlantLabel {
  rawLabel: string;
  crop: string;
  condition: string;
  healthy: boolean;
}

export function parsePlantVillageLabels(contents: string, expectedCount = 38): ParsedPlantLabel[] {
  const rawLabels = contents.split(/\r?\n/).map((label) => label.trim()).filter(Boolean);
  if (rawLabels.length !== expectedCount) {
    throw new Error(`PlantVillage labels are invalid: expected ${expectedCount}, found ${rawLabels.length}.`);
  }
  return rawLabels.map(parsePlantVillageLabel);
}

export function parsePlantVillageLabel(rawLabel: string): ParsedPlantLabel {
  const delimiter = rawLabel.indexOf('___');
  if (delimiter <= 0 || delimiter === rawLabel.length - 3) {
    throw new Error(`Invalid PlantVillage label: ${rawLabel || '(empty)'}.`);
  }
  const crop = humanize(rawLabel.slice(0, delimiter));
  const condition = humanize(rawLabel.slice(delimiter + 3));
  if (!crop || !condition) throw new Error(`Invalid PlantVillage label: ${rawLabel}.`);
  return { rawLabel, crop, condition, healthy: condition.toLowerCase() === 'healthy' };
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
}
