/**
 * Pasa a minúsculas y quita marcas diacríticas (tildes, etc.) para comparar textos.
 * Ej.: "María" y "maria" comparten la misma forma normalizada.
 */
export function foldAccents(input: string): string {
  const nfd = input.normalize('NFD');
  const withoutCombining = nfd.replace(/[\u0300-\u036f]/g, '');
  return withoutCombining.toLowerCase();
}
