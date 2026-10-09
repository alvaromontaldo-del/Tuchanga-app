/**
 * Los mismos textos se corren contra redactOffplatformContact (cliente)
 * y contra public.redact_offplatform_contact (SQL). Si uno cambia y el
 * otro no, el test de paridad falla.
 */
export const OFFPLATFORM_PARITY_CASES = [
  'te cobro 15000',
  'sale 25000 la mano de obra',
  'cobro 1500 la hora',
  'dejame 2500 de adelanto',
  'modelo 2024',
  'Cobro 15000 al terminar',
  'Año 2024',
  'código 1234 del portón',
  'Pasa a buscarla por Volta 1140',
  'Te paso mi dirección',
  'Pellegrini 570, piso 2',
  'estoy en Volta 1140',
  'Av. San Martín 2300',
  'avenida san martin 2300',
  'pasaje Rivadavia 450',
  'calle 12 n° 345',
  '$300.000',
  'veinte mil',
  '25 lucas',
  'las 15:30',
  '3364312302',
  '11 cero 2 veinte nueve 67',
  'Tres tres 6 y van más 4 trentaiuno 23 02',
  'La ubicación te la paso por Whatsapp pásame tu telefono',
  '¿me pasás el teléfono?',
  'hablamos por whatsapp en la obra',
  'Cinta 1234',
  'Llegá a Volta 1140, te espero en la vereda',
] as const;
