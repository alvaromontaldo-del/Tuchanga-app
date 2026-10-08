/**
 * Único lugar de los datos de la empresa.
 * Razón social, CUIT, domicilio legal, mail de contacto y jurisdicción
 * se cambian acá: el documento de términos los toma de este objeto.
 * docs/terminos-y-condiciones-2026-10-01.md es la misma copia para leerla fuera de la app.
 * Si cambiás estos valores, hay que volver a generar ese archivo: el test lo compara.
 */
export const COMPANY_LEGAL = {
  razonSocial: 'COMPLETAR',
  cuit: 'COMPLETAR',
  domicilioLegal: 'COMPLETAR',
  emailContacto: 'COMPLETAR',
  jurisdiccion: 'COMPLETAR',
} as const;
