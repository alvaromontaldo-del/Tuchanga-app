/**
 * Conteo y listado de materiales rechazados en el tablero del comercio.
 * Una fila de cotización es una marca. El material cuenta una sola vez.
 */

export type MaterialVariantLine = {
  requestItemId: string;
  /** Nombre del material, sin marca. */
  materialName: string;
  decision: 'accepted' | 'rejected' | 'pending';
};

export type RejectedMaterialsSummary = {
  rejectedCount: number;
  totalCount: number;
  /** «3 de 3 items rechazados» o «1 de 1 item rechazado». null si no hay rechazados. */
  countLabel: string | null;
  /** «Producto 1, producto 2 y producto 3». */
  namesLabel: string;
  rejectedNames: string[];
};

export function joinSpanishAnd(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/**
 * Un material está rechazado solo si todas sus marcas están rechazadas.
 * Si alguna marca se aceptó, el material no está rechazado.
 */
export function summarizeRejectedMaterials(
  lines: MaterialVariantLine[],
  totalMaterials = 0,
): RejectedMaterialsSummary {
  const groups = new Map<
    string,
    { name: string; accepted: boolean; rejected: number; variants: number }
  >();

  for (const line of lines) {
    const id = line.requestItemId.trim() || line.materialName.trim();
    if (!id) continue;
    const name = line.materialName.trim();
    const current = groups.get(id) ?? {
      name,
      accepted: false,
      rejected: 0,
      variants: 0,
    };
    current.variants += 1;
    if (name) current.name = name;
    if (line.decision === 'accepted') current.accepted = true;
    if (line.decision === 'rejected') current.rejected += 1;
    groups.set(id, current);
  }

  const rejectedNames: string[] = [];
  for (const group of groups.values()) {
    if (group.accepted) continue;
    if (group.variants > 0 && group.rejected === group.variants) {
      rejectedNames.push(group.name || 'Ítem');
    }
  }

  const distinct = groups.size;
  const declared =
    Number.isFinite(totalMaterials) && totalMaterials > 0 ? Math.floor(totalMaterials) : distinct;
  const totalCount = Math.max(declared, rejectedNames.length);
  const rejectedCount = rejectedNames.length;
  const countLabel =
    rejectedCount === 0
      ? null
      : rejectedCount === 1 && totalCount === 1
        ? '1 de 1 item rechazado'
        : `${rejectedCount} de ${totalCount} items rechazados`;

  return {
    rejectedCount,
    totalCount,
    countLabel,
    namesLabel: joinSpanishAnd(rejectedNames),
    rejectedNames,
  };
}
