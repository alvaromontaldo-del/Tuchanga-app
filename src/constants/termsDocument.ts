import { COMPANY_LEGAL } from './companyLegal';
import { TERMS_UPDATED_LABEL, TERMS_VERSION } from './terms';

export type TermsSection = {
  title: string;
  body: string;
};

export type TermsDocument = {
  title: string;
  updatedLabel: string;
  intro: string;
  sections: TermsSection[];
};

/** Texto vigente. Los datos de la empresa salen de COMPANY_LEGAL. */
export function buildTermsDocument(): TermsDocument {
  const c = COMPANY_LEGAL;
  return {
    title: 'Términos y Condiciones',
    updatedLabel: `Última actualización: ${TERMS_UPDATED_LABEL} · Versión ${TERMS_VERSION}`,
    intro:
      `Estos Términos y Condiciones (los “Términos”) regulan el acceso y el uso de la aplicación YaChanga (la “Plataforma”), operada por ${c.razonSocial}, CUIT ${c.cuit}, con domicilio en ${c.domicilioLegal}. ` +
      'Al crear una cuenta, o al aceptar una versión nueva, declarás que leíste estos Términos y que los aceptás. Esa aceptación queda registrada con la fecha y la versión vigente. Si no los aceptás, no te registres ni uses la Plataforma. ' +
      `Para consultas escribinos a ${c.emailContacto}. Clientes, profesionales y comercios aceptan este mismo documento.`,
    sections: [
      {
        title: '1. Definiciones',
        body:
          '“Usuario” es quien tiene una cuenta. “Cliente” pide trabajos y, si hace falta, materiales. “Profesional” (o trabajador) ofrece oficios y realiza trabajos. “Comercio” es un local que cotiza y vende materiales. Una misma cuenta puede reunir más de un rol cuando la app lo permite. “Costo de servicio” es el importe de YaChanga que la app muestra antes de pagar: no es el precio del profesional ni el precio del comercio. “PIN de inicio” sirve para comenzar un trabajo. “PIN de retiro” sirve para cerrar una entrega de materiales.',
      },
      {
        title: '2. Capacidad',
        body:
          'Solo pueden registrarse personas mayores de 18 años, con capacidad para contratar según la ley argentina. Quien carga un comercio declara que puede obligar a ese local. No corresponde usar la Plataforma si la cuenta fue suspendida.',
      },
      {
        title: '3. Qué es YaChanga',
        body:
          `YaChanga es un intermediario tecnológico. Pone en contacto a clientes, profesionales y comercios, muestra cotizaciones y cobra el costo de servicio. No presta el trabajo, no vende los materiales, no es el empleador de los profesionales y no es parte del acuerdo entre cliente y profesional ni de la compraventa entre cliente y comercio. Esas relaciones son directas y cada uno actúa por su cuenta. Nada de esto crea relación laboral, sociedad ni representación con ${c.razonSocial}. Lo que ves en la app invita a contratar entre usuarios: no es una oferta de YaChanga de hacer el trabajo o de vender los materiales.`,
      },
      {
        title: '4. La cuenta',
        body:
          `El registro pide, según el caso, nombre, apellido, documento, fecha de nacimiento, correo, teléfono, contraseña, foto y una dirección. Si ofrecés servicios, también una descripción, los oficios y un radio de cobertura. Si das de alta un comercio, el nombre, la foto o el logo, la dirección, los rubros y el horario del local son distintos de los datos del titular, y el local puede quedar pendiente de aprobación de un administrador antes de operar. Los datos tienen que ser verdaderos y estar actualizados. La contraseña es personal: respondés por lo que se haga con tu cuenta y tenés que avisar a ${c.emailContacto} si sospechás un uso indebido. Podés dar de baja el perfil profesional y seguir como cliente: en ese caso dejás de aparecer en las búsquedas como trabajador y tus publicaciones dejan de verse en el inicio.`,
      },
      {
        title: '5. Obligaciones del profesional',
        body:
          'Ofrecés el oficio con la idoneidad que declarás. Si la ley exige matrícula, habilitación o un seguro para ese rubro, tenés que tenerlos: YaChanga no los certifica ni los controla. La cotización, los plazos y la garantía que cargás te obligan frente al cliente. Si incluís garantía, es de 1 a 60 días, empieza cuando el trabajo queda finalizado por primera vez y, durante ese plazo, tenés que atender el reclamo en el chat de la Plataforma. No sos empleado de YaChanga.',
      },
      {
        title: '6. Obligaciones del comercio',
        body:
          'Cotizás con información veraz: precio, stock y, si no tenés el material, la alternativa que propongas. Podés cotizar retiro en el local, envío sin cargo o envío con costo. Ves el pedido para cotizarlo y, si indicaron una dirección de entrega, la usás para el flete. No recibís por la app el teléfono, el correo ni el documento del cliente. La entrega se cierra cuando ingresás el PIN que te dictan: ese PIN no se te muestra. El precio de los materiales, y el flete si entra en la orden, se cobra en el comercio, aparte del costo de servicio. Tenés que mantener actualizados los datos del local. El alta puede requerir la aprobación de un administrador.',
      },
      {
        title: '7. Costo de servicio y pagos',
        body:
          'El costo de servicio es el importe que la app muestra antes de pagar. Se abona con Mercado Pago, que procesa el cobro: YaChanga no guarda los datos de la tarjeta. En un trabajo, el precio final que ve el cliente incluye ese costo de servicio. El importe del profesional se arregla entre cliente y profesional; la app permite avisar ese pago y confirmarlo. Si la cotización cambia, el costo de servicio que muestra la app puede actualizarse, y la diferencia de ese costo también se paga por Mercado Pago. En materiales, el costo de servicio también es el que la app muestra antes de pagar, y es distinto del total que se abona al comercio.',
      },
      {
        title: '8. Cancelaciones y estado del pago',
        body:
          'Antes de pagar el costo de servicio, el cliente puede rechazar el presupuesto del profesional: el trabajo queda cancelado y ese cobro no se genera. También puede rechazar horarios o una recotización cuando la app lo ofrece, y rechazar una cotización de materiales que todavía no fue pagada. Salir de Mercado Pago antes de pagar no acredita el costo de servicio. Una cotización de materiales sin decisión puede rechazarse sola a las 72 horas. Si Mercado Pago informa que un pago fue rechazado, cancelado o reembolsado, la app registra ese estado. YaChanga no inicia desde la app el reembolso de un costo de servicio ya acreditado: si hay reembolso, lo procesa Mercado Pago. El precio del profesional y el de los materiales no son el costo de servicio, y se resuelven con el profesional o con el comercio.',
      },
      {
        title: '9. PIN para iniciar el trabajo',
        body:
          'Cuando el costo de servicio queda acreditado, el cliente recibe un PIN. El profesional lo ingresa para dar por iniciado el trabajo. No lo compartas con terceros. Varios intentos incorrectos pueden bloquear la verificación por un tiempo.',
      },
      {
        title: '10. Cierre del trabajo y del chat',
        body:
          'El profesional marca el trabajo como terminado y el cliente da su conformidad. El chat entre esas dos personas se quita de la app cuando el trabajo está finalizado, las dos partes lo confirmaron y el pago figura completo. También se quita cuando un reclamo de garantía se cierra con la conformidad del cliente. Si entre las mismas personas queda otro trabajo en curso o un reclamo abierto, ese chat sigue disponible. Al cerrarse el chat, su contenido y las imágenes asociadas pueden eliminarse.',
      },
      {
        title: '11. Garantía y reclamos',
        body:
          'Al cotizar, el profesional puede incluir una garantía de 1 a 60 días, o no incluir ninguna. El plazo empieza cuando el trabajo queda finalizado por primera vez. Durante ese plazo el cliente puede iniciar un reclamo, que se coordina por un chat de la Plataforma. El profesional puede marcar el arreglo como hecho y el cliente lo confirma. Si el cliente no responde dentro de las 72 horas desde que el profesional marcó el arreglo, el reclamo puede cerrarse de forma automática. Esa garantía es del profesional, no un seguro ni un compromiso de reintegro de YaChanga.',
      },
      {
        title: '12. Materiales, contacto del comercio y PIN de retiro',
        body:
          'Un cliente o un profesional puede pedir materiales a comercios. Cuando está pago el costo de servicio de ese pedido, el nombre, el teléfono y la dirección del comercio, el código de orden y el PIN de retiro los ven el cliente que pagó y el profesional que creó el pedido, aunque ese profesional no lo haya pagado él. El comercio nunca ve el PIN: lo ingresa para cerrar la entrega. No publiques ese PIN ni se lo pases a terceros. Si hay un costo de flete, quien pide elige si ese envío entra en la orden.',
      },
      {
        title: '13. Calificaciones',
        body:
          'Cuando el trabajo está finalizado, el cliente puede calificar y dejar un comentario sobre el profesional. Esas reseñas pueden mostrarse en el perfil del profesional, junto con el promedio. Tienen que ser respetuosas y referirse a un trabajo real.',
      },
      {
        title: '14. Chat',
        body:
          'El chat es el canal entre cliente y profesional para coordinar el trabajo. No está permitido enviar teléfonos ni correos electrónicos en los mensajes: la Plataforma puede rechazarlos. También puede limitar la extensión, la frecuencia y las imágenes. Podés bloquear a otra persona; mientras el bloqueo esté activo no se envían mensajes entre ustedes. Los avisos de sistema (por ejemplo un pago, un PIN o un reclamo) los genera la Plataforma.',
      },
      {
        title: '15. Propiedad intelectual',
        body:
          `El nombre YaChanga, la aplicación, su diseño, el software y las bases de datos son de ${c.razonSocial} o de quien le haya dado una licencia, y están protegidos por la ley. No podés copiarlos, modificarlos ni usarlos fuera de la Plataforma sin autorización. Esta cláusula no alcanza al contenido que suben los usuarios.`,
      },
      {
        title: '16. Contenido que subís',
        body:
          `Seguís siendo dueño de lo que subís: foto de perfil, fotos de oficios y de publicaciones, logo del comercio, mensajes e imágenes del chat, reseñas, la descripción profesional y, si la app te deja cargarlo, un video de presentación. Autorizás a ${c.razonSocial}, sin cargo y de forma no exclusiva, a alojar y mostrar ese contenido dentro de la Plataforma para operar el servicio, por ejemplo en tu perfil, en una publicación o en una reseña. Podés borrar lo que la app te deje borrar. El chat y sus imágenes pueden eliminarse cuando el chat se cierra. No subas contenido ajeno o ilícito.`,
      },
      {
        title: '17. Ubicación',
        body:
          'La dirección de tu perfil se usa para operar la cuenta y, si sos profesional, para la zona de cobertura. La dirección del trabajo se comparte con el profesional cuando el costo de servicio está pago. La dirección del comercio y, si corresponde, la de entrega de materiales se usan para cotizar, retirar o enviar.',
      },
      {
        title: '18. Datos personales',
        body:
          `Tratamos datos personales según la Ley 25.326 de Protección de Datos Personales de la República Argentina. Pueden incluir identidad y contacto, documento, fecha de nacimiento, foto, dirección y ubicación, oficios, mensajes, reseñas, datos del comercio y el identificador de notificaciones. Los usamos para crear y administrar la cuenta, conectar a las partes, cobrar el costo de servicio, prevenir abusos y cumplir la ley. Tenés derecho de acceso, de rectificación y de supresión. Para ejercerlos escribinos a ${c.emailContacto}. La autoridad de aplicación es la Agencia de Acceso a la Información Pública.`,
      },
      {
        title: '19. Notificaciones',
        body:
          'Si autorizás las notificaciones del dispositivo, guardamos un identificador para avisarte de trabajos, mensajes o pedidos. Podés desactivarlas en el teléfono. Los avisos sobre tu cuenta y sobre estos Términos pueden hacerse dentro de la app, por esas notificaciones si están activas, o al correo con el que te registraste. Esos medios alcanzan como notificación.',
      },
      {
        title: '20. Conducta prohibida',
        body:
          'No uses la Plataforma para fraudes, suplantación de identidad, acoso, discriminación, contenido ilícito ni para eludir el costo de servicio, los PIN o los controles de la app. No cargues datos falsos, no interfieras con el servicio ni intentes entrar a cuentas o datos ajenos.',
      },
      {
        title: '21. Suspensión de la cuenta',
        body:
          `YaChanga puede suspender o dar de baja una cuenta, o quitar un contenido, ante un incumplimiento de estos Términos, un uso abusivo o un requerimiento legal. Una cuenta dada de baja no puede ingresar hasta que se reactive. Para pedir la reactivación escribinos a ${c.emailContacto}.`,
      },
      {
        title: '22. Defensa del consumidor',
        body:
          'Si usás la Plataforma como consumidor, se aplica la Ley 24.240 de Defensa del Consumidor y las normas que no se pueden dejar de lado. El reclamo por cómo se hizo el trabajo se dirige al profesional, y el de los materiales al comercio. YaChanga, como intermediaria, pone el chat y el reclamo de garantía que la app ya tiene, y eso no la vuelve parte de esos contratos. Podés reclamar ante la autoridad de defensa del consumidor. Nada de estos Términos limita los derechos irrenunciables del consumidor.',
      },
      {
        title: '23. Responsabilidad',
        body:
          'En la medida en que la ley lo permita, YaChanga no responde por la ejecución del trabajo, la calidad o la entrega de los materiales, los daños personales o materiales, los robos, las demoras, los desacuerdos entre usuarios ni por la veracidad de lo que cada persona declara. Las recomendaciones de la app no reemplazan tu propio criterio. Tampoco responde por interrupciones del teléfono, de internet o de Mercado Pago que estén fuera de su control, ni por hechos de fuerza mayor, más allá de lo que la ley imponga.',
      },
      {
        title: '24. Cesión, renuncia y nulidad parcial',
        body:
          `No podés ceder la cuenta ni estos Términos. ${c.razonSocial} puede ceder la operación de la Plataforma, y te lo avisa por los medios de la cláusula de notificaciones. Que una vez no ejerzamos un derecho no significa que renunciemos a hacerlo después. Si alguna cláusula se declara nula, las demás siguen vigentes. Estos Términos son el acuerdo sobre el uso de la Plataforma.`,
      },
      {
        title: '25. Cambios de estos Términos',
        body:
          'Podemos actualizar estos Términos. La versión y la fecha de actualización figuran al comienzo. Si la versión cambia, la app te pide aceptarla para seguir usándola. Si no aceptás, no vas a poder continuar con esa cuenta. Los trabajos ya acreditados siguen con las reglas que la app mostró al pagar ese costo de servicio, salvo que el cambio te favorezca.',
      },
      {
        title: '26. Ley y jurisdicción',
        body:
          `Estos Términos se rigen por las leyes de la República Argentina. Para cualquier controversia son competentes los tribunales ordinarios de ${c.jurisdiccion}, sin perjuicio de las normas de defensa del consumidor que resulten irrenunciables.`,
      },
      {
        title: '27. Contacto',
        body: `${c.razonSocial} — ${c.emailContacto} — ${c.domicilioLegal}`,
      },
    ],
  };
}

/** Misma copia que el modal, para revisarla fuera de la app. */
export function renderTermsMarkdown(): string {
  const doc = buildTermsDocument();
  const sections = doc.sections
    .map((section) => `## ${section.title}\n\n${section.body}`)
    .join('\n\n');
  return `# ${doc.title}\n\n${doc.updatedLabel}\n\n${doc.intro}\n\n${sections}\n`;
}
