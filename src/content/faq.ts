/**
 * Preguntas frecuentes de Cuenta (cliente, profesional y comercio).
 * Solo texto: se publica por OTA, sin dependencias nativas.
 *
 * Cada respuesta está contrastada con el código de la app. No incluye
 * porcentajes ni montos del costo de servicio: esa fórmula cambia aparte.
 */

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: 'pago-app-vs-profesional',
    question: '¿Qué pago en la app y qué le pago al profesional?',
    answer:
      'En la app el cliente paga el costo de servicio de YaChanga con Mercado Pago. El precio final del presupuesto incluye ese costo y el importe del profesional. Lo del profesional se paga por fuera de la app: el cliente lo marca en el chat cuando se lo dio y el profesional confirma que lo recibió. En Mis trabajos, el profesional ve su neto, sin el costo de servicio.',
  },
  {
    id: 'costo-cubierto',
    question: '¿Qué pasa con el costo de servicio si hay un problema con el profesional?',
    answer:
      'Si ocurre un problema con el profesional, el costo de servicio de YaChanga queda cubierto por la app. Esa cobertura es del costo de servicio. No reemplaza el importe que se le paga al profesional por fuera de la app.',
  },
  {
    id: 'garantia',
    question: '¿Cómo funciona la garantía?',
    answer:
      'Al presupuestar, el profesional indica si incluye garantía. Si la incluye, carga la cantidad de días: de 1 a 60. También puede cotizar sin garantía. El plazo empieza la primera vez que el trabajo queda marcado como finalizado y no vuelve a cero si después se abre un reclamo. Mientras quedan días, el cliente puede abrir un reclamo desde Trabajos contratados. Se abre un chat con el profesional para coordinar la revisión y el plazo sigue corriendo. Si el profesional marca el arreglo y el cliente no confirma en 72 horas, el reclamo se cierra solo.',
  },
  {
    id: 'no-se-presenta',
    question: '¿Qué pasa si el profesional no se presenta?',
    answer:
      'No hay un botón de «no se presentó». Se coordina por el chat del trabajo. Si ya se pagó el costo de servicio y el problema es con el profesional, ese costo queda cubierto por la app. El pago al profesional es aparte y se hace fuera de YaChanga.',
  },
  {
    id: 'trabajo-mal-hecho',
    question: '¿Qué pasa si el trabajo queda mal hecho?',
    answer:
      'Si el trabajo ya está finalizado y la garantía sigue vigente, el cliente entra a Cuenta, Trabajos contratados, y toca Iniciar reclamo. Se abre el chat para coordinar la garantía. Los días no se reinician. Si el presupuesto no incluyó garantía, o ya se venció, la app no abre ese reclamo.',
  },
  {
    id: 'pague-y-cancela',
    question: '¿Qué pasa si pagué el costo de servicio y el profesional cancela?',
    answer:
      'Antes de pagar, el cliente puede rechazar el presupuesto desde el chat y el trabajo queda cancelado. La app no tiene un botón para que el profesional cancele por su cuenta después de acreditado el costo de servicio. Si igual el trabajo no se hace, el costo de servicio de YaChanga queda cubierto por la app. Lo del profesional se paga por fuera: si todavía no se lo dieron, no queda registrado como pagado dentro de YaChanga.',
  },
  {
    id: 'pin',
    question: '¿Para qué es el PIN y qué hago si lo pierdo?',
    answer:
      'Cuando se acredita el costo de servicio del trabajo, el cliente ve un PIN en el chat, en el recuadro de costo de servicio pagado. Se lo dice al profesional al llegar: el profesional no lo ve en su pantalla y lo escribe para iniciar el trabajo. No se genera otro PIN. Si lo carga mal 5 veces, el ingreso queda bloqueado 15 minutos y después se puede reintentar. El PIN de materiales es otro: después de pagar el costo de servicio lo ven el cliente que pagó y el profesional que creó el pedido, aunque el profesional no haya pagado. Se lo dictan al comercio, que nunca lo ve y lo escribe para cerrar la entrega.',
  },
  {
    id: 'pago-no-acreditado',
    question: '¿Qué pasa si el pago no se acredita?',
    answer:
      'Al volver de Mercado Pago, la app espera la confirmación. Si tarda, el pago figura en proceso y se puede tocar Sincronizar. Si Mercado Pago no completó el pago, el costo de servicio no queda acreditado y se puede intentar el checkout de nuevo. Hasta que se acredita, no aparece el PIN.',
  },
  {
    id: 'chat',
    question: '¿El chat muestra mi teléfono o mi mail?',
    answer:
      'El chat es entre el cliente y el profesional. No se pueden mandar teléfonos ni mails: si el mensaje los trae, no se envía. El chat se saca cuando las dos partes confirmaron que el trabajo terminó y el pago está completo, o cuando un reclamo se cierra con la conformidad del cliente. Si todavía tienen otro trabajo o un reclamo abierto entre ellos, el chat sigue.',
  },
  {
    id: 'calificaciones',
    question: '¿Cómo son las calificaciones?',
    answer:
      'Cuando el profesional marca el trabajo como finalizado, el cliente puede dejar de 1 a 5 estrellas y un comentario en el chat. El profesional recibe un aviso. Las estrellas y las reseñas públicas se muestran a partir del segundo trabajo finalizado. Antes, el perfil figura como nuevo. En las reseñas se ve el nombre del cliente, sin el apellido.',
  },
  {
    id: 'materiales',
    question: '¿Cómo funcionan los materiales, el flete y el PIN del comercio?',
    answer:
      'El profesional arma el pedido y lo envía a comercios del rubro. Cada comercio cotiza. El cliente elige los ítems. El flete se suma solo si lo marca; si no, el retiro es en el local. El costo de servicio de YaChanga de esos materiales se paga con Mercado Pago. Los materiales se le pagan al comercio al retirar, fuera de la app. Hasta ese pago, el comercio queda oculto. Después, el cliente que pagó y el profesional que creó el pedido ven el teléfono, la dirección del comercio y el PIN de retiro, aunque el profesional no haya pagado. El comercio nunca ve el PIN: lo escribe cuando se lo dictan, junto con el código, para cerrar la entrega. El comercio no ve el teléfono ni el mail del cliente. Sí puede ver el nombre de pila y, si el pedido tiene dirección de entrega, esa dirección para cotizar el flete.',
  },
  {
    id: 'sin-material',
    question: '¿Qué pasa si el comercio no tiene el material?',
    answer:
      'Al cotizar, el comercio puede marcar «No tengo este material». Si ofrece una alternativa, carga la marca y el precio. Si no tiene alternativa, puede dejar ese ítem sin precio. El cliente decide qué ítems aceptar. No se puede confirmar un pedido que sea solo flete.',
  },
  {
    id: 'baja-profesional',
    question: '¿Puedo dar de baja el perfil de profesional?',
    answer:
      'Sí. En Editar perfil profesional está «Dar de baja». La cuenta sigue y se puede usar la app como cliente. El perfil deja de aparecer en las búsquedas y las publicaciones dejan de verse en el inicio. Más adelante se puede volver a crear el perfil profesional.',
  },
  {
    id: 'notificaciones',
    question: '¿Qué notificaciones voy a recibir?',
    answer:
      'Si tenés los avisos del teléfono activados, YaChanga avisa de mensajes nuevos, de que se acreditó el costo de servicio, de que el trabajo se marcó finalizado (para dejar la reseña), del saldo y de una reseña nueva. Al comercio le avisa cuando hay pedidos en el tablero. Si tocás un aviso de chat, se abre esa conversación. Si tocás uno del comercio, se abre el tablero de pedidos.',
  },
];
