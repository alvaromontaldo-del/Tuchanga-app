import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMotivoDisputa,
  COSTO_SERVICIO_LABEL,
  puedeIniciarPagoCostoServicio,
  SALDO_FUERA_DE_APP,
  textoVisibleSinSena,
} from './serviceCostCopy';
import { SIGNUP_ROLE_OPTIONS, sessionRoleForSignup } from './sessionRoles';

describe('copy de costo de servicio', () => {
  it('usa un solo término y no dice seña', () => {
    expect(COSTO_SERVICIO_LABEL).toBe('Costo de servicio YaChanga');
    expect(COSTO_SERVICIO_LABEL.toLowerCase()).not.toContain('seña');
    expect(SALDO_FUERA_DE_APP).toContain('fuera de la app');
    expect(SALDO_FUERA_DE_APP).toContain('Mercado Pago');
    expect(SALDO_FUERA_DE_APP.toLowerCase()).not.toContain('seña');
  });

  it('no deja pagar el costo sin aceptar el saldo fuera de la app', () => {
    expect(puedeIniciarPagoCostoServicio(false)).toBe(false);
    expect(puedeIniciarPagoCostoServicio(true)).toBe(true);
  });

  it('arma el motivo de disputa y no abre un reclamo de garantía', () => {
    expect(buildMotivoDisputa('Otro', 'Faltó el zócalo')).toBe('Otro. Faltó el zócalo');
    const modal = readFileSync('src/components/jobs/ReportarProblemaModal.tsx', 'utf8');
    expect(modal).toContain('conforme: false');
    expect(modal).not.toContain('iniciarReclamoGarantia');
  });

  it('la migración pide conformidad y no oculta el chat si hay un problema', () => {
    const sql = readFileSync(
      'supabase/migrations/20261001190000_copy_costo_servicio_y_conformidad.sql',
      'utf8',
    );
    expect(sql).toContain("estado_trabajo = 'pendiente_conformidad'");
    expect(sql).toContain('Costo de servicio YaChanga');
    expect(sql.toLowerCase()).not.toContain('seña pagada correctamente');
    const negativa = sql.slice(sql.indexOf('IF p_conforme THEN'));
    const rechazo = negativa.slice(negativa.indexOf('ELSE'));
    expect(rechazo).toContain('conformidad_aceptada = false');
    expect(rechazo).not.toContain('hide_pair_chats_if_done');
    expect(sql).not.toContain('iniciar_reclamo_garantia');
    expect(negativa.slice(0, negativa.indexOf('ELSE'))).toContain('hide_pair_chats_if_done');
  });

  it('reescribe seña visible y deja intactas reseña y contraseña', () => {
    expect(textoVisibleSinSena('La seña fue pagada.')).toBe(
      'El costo de servicio YaChanga fue pagado.',
    );
    expect(textoVisibleSinSena('Dejá tu reseña y cambiá la contraseña.')).toBe(
      'Dejá tu reseña y cambiá la contraseña.',
    );
  });
});

describe('selector de rol', () => {
  it('ofrece Cliente, Profesional y Comercio, sin copy de testing', () => {
    expect(SIGNUP_ROLE_OPTIONS.map((role) => role.title)).toEqual([
      'Cliente',
      'Profesional',
      'Comercio',
    ]);
    for (const role of SIGNUP_ROLE_OPTIONS) {
      expect(role.description.length).toBeGreaterThan(10);
    }
    const picker = readFileSync('src/components/auth/SessionRolePickerModal.tsx', 'utf8');
    expect(picker).not.toMatch(/provisorio|testing/i);
    expect(picker).not.toContain('Cliente / Profesional');
    expect(picker).toContain('RoleChoiceList');
  });

  it('profesional y cliente no entran al módulo comercio', () => {
    expect(sessionRoleForSignup('client')).toBe('client');
    expect(sessionRoleForSignup('professional')).toBe('professional');
    expect(sessionRoleForSignup('commerce')).toBe('commerce');
  });
});
