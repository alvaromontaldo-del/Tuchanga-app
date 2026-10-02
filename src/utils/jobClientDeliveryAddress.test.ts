import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isMissingDeliveryAddressRpc,
  pickJobClientDelivery,
} from './jobClientDeliveryAddress';

const PRO = '22222222-2222-4222-8222-222222222222';
const CLIENT = '11111111-1111-4111-8111-111111111111';

describe('dirección del cliente del trabajo', () => {
  it('usa el domicilio del cliente y descarta el del profesional', () => {
    expect(
      pickJobClientDelivery({
        professionalId: PRO,
        clientId: CLIENT,
        address: '  Av. Siempre Viva 742 ',
        lat: -34.6,
        lng: -58.4,
      }),
    ).toEqual({
      clientId: CLIENT,
      address: 'Av. Siempre Viva 742',
      lat: -34.6,
      lng: -58.4,
    });

    expect(
      pickJobClientDelivery({
        professionalId: PRO,
        clientId: PRO,
        address: 'Domicilio del profesional 1',
        lat: -34.7,
        lng: -58.5,
      }),
    ).toBeNull();

    expect(
      pickJobClientDelivery({
        professionalId: '  ',
        clientId: CLIENT,
        address: 'Calle 1',
        lat: -34.6,
        lng: -58.4,
      }),
    ).toBeNull();
  });

  it('no guarda un punto inválido ni una dirección vacía', () => {
    expect(
      pickJobClientDelivery({
        professionalId: PRO,
        clientId: CLIENT,
        address: 'Calle 10',
        lat: 0,
        lng: 0,
      }),
    ).toEqual({
      clientId: CLIENT,
      address: 'Calle 10',
      lat: null,
      lng: null,
    });

    expect(
      pickJobClientDelivery({
        professionalId: PRO,
        clientId: CLIENT,
        address: null,
        lat: -34.6,
        lng: null,
      }),
    ).toBeNull();

    expect(
      pickJobClientDelivery({
        professionalId: PRO,
        clientId: CLIENT,
        address: '   ',
        lat: null,
        lng: null,
      }),
    ).toBeNull();
  });

  it('reconoce que el RPC de dirección todavía no está desplegado', () => {
    expect(
      isMissingDeliveryAddressRpc({
        code: 'PGRST202',
        message: 'Could not find the function public.get_conversation_client_delivery_address',
      }),
    ).toBe(true);
    expect(isMissingDeliveryAddressRpc({ code: '42501', message: 'permission denied' })).toBe(
      false,
    );
    expect(isMissingDeliveryAddressRpc(null)).toBe(false);
  });
});

describe('formulario de pedido de materiales', () => {
  const screen = readFileSync('src/screens/materials/CreateMaterialRequestScreen.tsx', 'utf8');
  const service = readFileSync('src/services/materialRequestsSupabase.ts', 'utf8');
  const sql = readFileSync('supabase/20261002_materials_request_client_address.sql', 'utf8');

  it('no muestra dirección de entrega ni opción de otra dirección', () => {
    expect(screen).not.toContain('Dirección de entrega');
    expect(screen).not.toContain('AddressDeliveryField');
    expect(screen).not.toContain('Usar ubicación actual');
    expect(screen).not.toContain('usar otra');
    expect(screen).not.toContain('fetchProfileDeliveryAddress');
    expect(screen).toContain('Rubro');
    expect(screen).toContain('Ítems');
    expect(screen).toContain('Agregar ítem');
    expect(screen).toContain('Enviar a comercios del rubro');
  });

  it('el alta toma el domicilio del cliente del chat y sigue avisando a los comercios', () => {
    expect(service).toContain('fetchConversationClientDeliveryAddress');
    expect(service).toContain("rpc('get_conversation_client_delivery_address'");
    expect(service).toContain(".select('cliente_id,trabajador_id')");
    expect(service).toContain('fetchProfileDeliveryAddress(clienteId)');
    expect(service).not.toContain('fetchProfileDeliveryAddress(professionalId)');
    expect(service).not.toContain('fetchProfileDeliveryAddress(trabajadorId)');
    expect(service).toContain("client_id: delivery.clientId");
    expect(service).toContain('push_on_store_board');
    expect(service).toContain('Tenés una nueva solicitud de cotización.');
    const createFn = service.slice(service.indexOf('export async function createMaterialRequestWithTargets'));
    expect(createFn).not.toContain('input.clientAddress');
    expect(createFn).not.toContain('input.clientLat');
  });

  it('el SQL copia el perfil del cliente del chat y no el del profesional', () => {
    expect(sql).toContain('get_conversation_client_delivery_address');
    expect(sql).toContain('WHERE p.id = v_cliente');
    expect(sql).not.toContain('WHERE p.id = v_trabajador');
    expect(sql).toContain('NEW.client_id := v_cliente');
    expect(sql).toContain('trg_material_requests_client_job_address');
    expect(sql).not.toContain('calculate_material_service_fee');
    expect(sql).not.toContain('verification_pin');
  });

  it('el SQL no expone la calle sin trabajo pagado ni deja usar un chat ajeno', () => {
    expect(sql).toContain("k.estado_pago IN ('seña_pagada', 'totalmente_pagado')");
    expect(sql).toContain('CASE WHEN v_show_street THEN');
    expect(sql).toContain('material_request_not_conversation_worker');
    expect(sql).toContain('FROM anon');
  });
});
