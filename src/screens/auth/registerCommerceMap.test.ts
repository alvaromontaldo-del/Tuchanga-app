import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const register = readFileSync('src/screens/auth/RegisterScreen.tsx', 'utf8');
const field = readFileSync('src/components/location/AddressDeliveryField.tsx', 'utf8');

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('mapa en el alta de comercio', () => {
  const commerceAddress = sliceBetween(
    register,
    'Buscá la calle y elegí una sugerencia para ver el mapa',
    'Rubros * (podés elegir varios)',
  );

  it('muestra el mapa al elegir una sugerencia, sin recortarlo ni ofrecer GPS del local', () => {
    expect(commerceAddress).toContain('showMap');
    expect(commerceAddress).toContain('showUseCurrentLocation={false}');
    expect(commerceAddress).toContain('elegí una sugerencia para ver el mapa');
    expect(commerceAddress).not.toContain('storeMap');
    expect(commerceAddress).not.toContain('height: 220');
    expect(commerceAddress).not.toContain("overflow: 'hidden'");
    expect(commerceAddress).not.toContain('<LocationMap');
    expect(commerceAddress).not.toContain('Usar GPS del local');
    expect(commerceAddress).not.toContain('Usar la dirección del titular');
    expect(commerceAddress).not.toContain('Usar dirección del titular');
    expect(commerceAddress).not.toContain('onLocateMe');

    expect(field).toContain('showMap && geo');
    expect(field).toContain('<LocationMap');
    expect(field).toContain('onPinMoved={onMapPinMoved}');
    expect(field).toContain('isNegligiblePinMove');
    expect(field).toContain('addressToPersist');
    expect(field).not.toContain('onLocateMe');
    expect(field).not.toContain('Usar GPS del local');
    expect(field).not.toContain('Usar la dirección del titular');
  });

  it('el alta de cliente y profesional sigue con su mapa y el pin', () => {
    const baseLocation = sliceBetween(register, 'Ubicación base *', 'Detalles para ubicar el domicilio');
    expect(baseLocation).toContain('<LocationMap');
    expect(baseLocation).toContain('onLocateMe');
    expect(baseLocation).toContain('onPinMoved');
    expect(baseLocation).toContain('isNegligiblePinMove');
    expect(baseLocation).not.toContain('AddressDeliveryField');
    expect(register).toContain('accessibilityLabel="Volver"');
    expect(register).toContain('leaveRegister');
  });
});

describe('no se tocan las pantallas vecinas del mapa', () => {
  it('editar registro sigue mostrando su mapa', () => {
    const editRegistration = readFileSync('src/screens/account/EditRegistrationScreen.tsx', 'utf8');
    expect(editRegistration).toContain('<LocationMap');
    expect(editRegistration).toContain('onLocateMe');
    expect(editRegistration).not.toContain('AddressDeliveryField');
  });

  it('la ruta vieja de alta comercio sigue entrando al formulario de Register', () => {
    const wrapper = readFileSync('src/screens/auth/RegisterCommerceScreen.tsx', 'utf8');
    expect(wrapper).toContain("registerAuthTarget('commerce')");
    expect(wrapper).not.toContain('AppTextInput');
    expect(wrapper).not.toContain('Usar mi ubicación');
    expect(wrapper).not.toContain('AddressDeliveryField');
  });

  it('el horario corrido/cortado y el aviso de comercio pendiente siguen en su lugar', () => {
    expect(register).toContain('<StoreOpeningHoursEditor');
    expect(readFileSync('src/components/store/StoreOpeningHoursEditor.tsx', 'utf8')).toContain(
      'Cortado',
    );
    const notice = readFileSync('src/context/pendingCommerceNotice.ts', 'utf8');
    expect(notice).toContain(
      'Su comercio está siendo validado por un administrador. Aguarde entre 24 y 48 hs para poder ingresar.',
    );
  });

  it('el login por rol y el nombre sin apellido del cliente no cambian', () => {
    const signup = readFileSync('src/screens/auth/SignupRoleScreen.tsx', 'utf8');
    const entry = readFileSync('src/navigation/signupRoleEntry.ts', 'utf8');
    expect(signup).toContain('SIGNUP_ROLE_SCREEN_OPTIONS');
    expect(entry).toContain("title: 'Cliente'");
    expect(entry).toContain("title: 'Profesional'");
    expect(entry).toContain("title: 'Comercio'");
    expect(signup).not.toContain('Soy comercio');
    expect(entry).not.toContain('Soy comercio');
    const displayName = readFileSync('src/utils/professionalDisplayName.ts', 'utf8');
    expect(displayName).toContain('professionalDisplayNameForClient');
    expect(displayName).toContain('No recibe ni devuelve el apellido');
    expect(displayName).not.toContain('lastName');
  });
});
