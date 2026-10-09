import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  documentNumberIsLocked,
  formatArgentineCuit,
  isValidArgentineCuit,
} from './argentineCuit';

describe('CUIT argentino', () => {
  it('acepta 11 dígitos con dígito verificador y rechaza el resto', () => {
    // 2*5+0*4+1*3+2*2+3*7+4*6+5*5+6*4+7*3+8*2 = 148; 148 % 11 = 5; 11-5 = 6
    expect(isValidArgentineCuit('20123456786')).toBe(true);
    expect(isValidArgentineCuit('20-12345678-6')).toBe(true);
    expect(isValidArgentineCuit('20-12345678-0')).toBe(false);
    expect(isValidArgentineCuit('2012345678')).toBe(false);
    expect(isValidArgentineCuit('201234567861')).toBe(false);
    expect(isValidArgentineCuit('')).toBe(false);
  });

  it('enmascara XX-XXXXXXXX-X', () => {
    expect(formatArgentineCuit('2')).toBe('2');
    expect(formatArgentineCuit('20')).toBe('20');
    expect(formatArgentineCuit('20123')).toBe('20-123');
    expect(formatArgentineCuit('20123456786')).toBe('20-12345678-6');
    expect(formatArgentineCuit('20-12345678-6')).toBe('20-12345678-6');
  });

  it('bloquea el documento solo cuando ya tiene al menos 7 dígitos', () => {
    expect(documentNumberIsLocked('30111222')).toBe(true);
    expect(documentNumberIsLocked('20-12345678-6')).toBe(true);
    expect(documentNumberIsLocked('')).toBe(false);
    expect(documentNumberIsLocked('0')).toBe(false);
    expect(documentNumberIsLocked(null)).toBe(false);
  });
});

describe('registro y Mis datos (#111 #112)', () => {
  const register = readFileSync('src/screens/auth/RegisterScreen.tsx', 'utf8');
  const edit = readFileSync('src/screens/account/EditRegistrationScreen.tsx', 'utf8');
  const persist = readFileSync('src/services/supabaseUser.ts', 'utf8');

  it('el alta compartida de cliente, profesional y comercio ofrece CUIT', () => {
    expect(register).toContain('Registrar con CUIT');
    expect(register).toContain('formatArgentineCuit');
    expect(register).toContain("documentType === 'cuit' ? 'cuit' : 'dni'");
    expect(register).not.toContain('asCommerce && documentType');
  });

  it('Mis datos muestra el documento bloqueado y deja cargarlo si falta', () => {
    expect(edit).toContain('documentNumberIsLocked');
    expect(edit).toContain('editable={!dniLocked}');
    expect(edit).toContain('El documento no se puede modificar.');
  });

  it('el alta guarda el tipo en document_type y el número en dni', () => {
    expect(persist).toContain('p_document_type:');
    expect(persist).toContain("documentType === 'cuit' ? 'cuit' : 'dni'");
  });
});
