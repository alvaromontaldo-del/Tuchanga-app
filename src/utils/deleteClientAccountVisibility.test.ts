import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { showDeleteClientAccountButton } from './deleteClientAccountVisibility';

describe('showDeleteClientAccountButton', () => {
  it('muestra el botón solo para la cuenta cliente', () => {
    expect(
      showDeleteClientAccountButton({
        sessionRole: 'client',
        isWorker: false,
        isCommerceShell: false,
      }),
    ).toBe(true);
    expect(
      showDeleteClientAccountButton({
        sessionRole: null,
        isWorker: false,
        isCommerceShell: false,
      }),
    ).toBe(true);
  });

  it('no aparece en profesional ni en comercio', () => {
    expect(
      showDeleteClientAccountButton({
        sessionRole: 'professional',
        isWorker: true,
        isCommerceShell: false,
      }),
    ).toBe(false);
    expect(
      showDeleteClientAccountButton({
        sessionRole: 'client',
        isWorker: true,
        isCommerceShell: false,
      }),
    ).toBe(false);
    expect(
      showDeleteClientAccountButton({
        sessionRole: 'commerce',
        isWorker: false,
        isCommerceShell: true,
      }),
    ).toBe(false);
    expect(
      showDeleteClientAccountButton({
        sessionRole: null,
        isWorker: false,
        isCommerceShell: true,
      }),
    ).toBe(false);
  });
});

describe('eliminar cuenta cliente en Modificar datos', () => {
  const edit = readFileSync('src/screens/account/EditRegistrationScreen.tsx', 'utf8');
  const service = readFileSync('src/services/supabaseUser.ts', 'utf8');

  it('queda debajo de Guardar cambios, más chico, y pide confirmación', () => {
    const saveAt = edit.indexOf('title="Guardar cambios"');
    const deleteAt = edit.indexOf('>Eliminar cuenta<');
    expect(saveAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(saveAt);
    expect(edit).toContain('showDeleteClientAccountButton');
    expect(edit).toContain('accessibilityLabel="Eliminar cuenta de cliente"');
    expect(edit).toContain('Se va a eliminar definitivamente tu cuenta de cliente');
    expect(edit).toContain("style: 'destructive'");
    expect(edit).toContain('deleteCurrentUserAccountInSupabase');
    expect(edit).toContain('styles.deleteAccountBtn');
    expect(edit).toContain('minHeight: 36');
    expect(edit).toContain('fontSize: 14');
    expect(edit).not.toContain('deactivate_professional_profile');
  });

  it('usa la RPC existente y cierra la sesión después', () => {
    expect(service).toContain("rpc('delete_user_account')");
    expect(edit).toContain('await signOut()');
    expect(edit).toContain('clearSessionRole');
    expect(edit).toContain('clearCommerceIntent');
  });

  it('no reemplaza la baja de profesional ni el editor de comercio', () => {
    const worker = readFileSync('src/screens/account/WorkerABMScreen.tsx', 'utf8');
    const store = readFileSync('src/screens/store/EditStoreScreen.tsx', 'utf8');
    const commerce = readFileSync('src/screens/store/CommerceAccountScreen.tsx', 'utf8');
    expect(worker).toContain('Dar de baja (eliminar)');
    expect(worker).toContain('deactivateProfessionalProfileInSupabase');
    expect(worker).not.toContain('delete_user_account');
    expect(worker).not.toContain('Eliminar cuenta');
    expect(store).not.toContain('delete_user_account');
    expect(store).not.toContain('Eliminar cuenta');
    expect(commerce).not.toContain('delete_user_account');
    expect(commerce).not.toContain('Eliminar cuenta');
  });
});
