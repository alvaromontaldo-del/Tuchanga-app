import { useEffect, useMemo, useState } from 'react';

import { Text, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';

import { AppTextInput } from '../../components/common/AppTextInput';

import { TextLink } from '../../components/common/TextLink';

import { useAppToast } from '../../components/toast/toast';

import { RECOVERY_OTP_TTL_MS } from '../../config/passwordRecovery';

import { useAuth } from '../../context/AuthContext';

import {

  closeAuthModalAndGoToInicio,

  navigateToInicioTab,

} from '../../navigation/openAuthModal';

import type { AuthStackScreenProps } from '../../navigation/types';

import {

  getRecoveryResendCooldownMs,

  resendPasswordRecoveryOtp,

  setPasswordFromActiveRecoverySession,

  verifyRecoveryOtpAndSetPassword,

} from '../../services/passwordAuth';

import {

  getPasswordRegistrationError,

  passwordsMatch,

} from '../../utils/validation';

import { AuthPasswordFormShell } from './AuthPasswordFormShell';

import { authFormStyles as styles } from './authFormStyles';



type Props = AuthStackScreenProps<'ResetPassword'>;



function formatCountdown(totalSec: number): string {

  const m = Math.floor(totalSec / 60);

  const s = totalSec % 60;

  return `${m}:${String(s).padStart(2, '0')}`;

}



/**

 * Paso 2 recuperación: verifyOtp (recovery) + updateUser, o solo updateUser si llegó por deep link.

 */

export function ResetPasswordScreen({ navigation, route }: Props) {

  const email = route.params.email;

  const verifiedViaLink = Boolean(route.params.verifiedViaLink);

  const otpSentAt = route.params.otpSentAt ?? Date.now();

  const { signIn: setSession } = useAuth();

  const toast = useAppToast();



  const [otp, setOtp] = useState('');

  const [newPassword, setNewPassword] = useState('');

  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);

  const [resendLoading, setResendLoading] = useState(false);

  const [resendCooldownSec, setResendCooldownSec] = useState(

    Math.ceil(getRecoveryResendCooldownMs() / 1000),

  );

  const [otpExpiresAt, setOtpExpiresAt] = useState(otpSentAt + RECOVERY_OTP_TTL_MS);

  const [nowTick, setNowTick] = useState(Date.now());



  const [otpError, setOtpError] = useState('');

  const [newError, setNewError] = useState('');

  const [confirmError, setConfirmError] = useState('');

  const [submitError, setSubmitError] = useState('');



  useEffect(() => {

    if (!verifiedViaLink) return;

    toast.info(

      'Enlace verificado. Elegí tu nueva contraseña para continuar.',

      'YaChanga',

      { durationMs: 4500 },

    );

  }, [verifiedViaLink, toast]);



  useEffect(() => {

    const id = setInterval(() => setNowTick(Date.now()), 1000);

    return () => clearInterval(id);

  }, []);



  useEffect(() => {

    if (resendCooldownSec <= 0) return;

    const id = setInterval(() => {

      setResendCooldownSec((prev) => Math.max(0, prev - 1));

    }, 1000);

    return () => clearInterval(id);

  }, [resendCooldownSec]);



  const otpRemainingSec = useMemo(

    () => Math.max(0, Math.ceil((otpExpiresAt - nowTick) / 1000)),

    [otpExpiresAt, nowTick],

  );



  const otpExpired = !verifiedViaLink && otpRemainingSec <= 0;



  function validate(): boolean {

    let ok = true;

    setOtpError('');

    setNewError('');

    setConfirmError('');

    setSubmitError('');



    if (!verifiedViaLink && !otp.trim()) {

      setOtpError('El código es obligatorio.');

      ok = false;

    }

    if (!verifiedViaLink && otpExpired) {

      setOtpError('El código venció. Usá «Reenviar código» para recibir uno nuevo.');

      ok = false;

    }

    const pwdErr = getPasswordRegistrationError(newPassword);

    if (pwdErr) {

      setNewError(pwdErr);

      ok = false;

    }

    if (!confirmPassword) {

      setConfirmError('Confirmá la nueva contraseña.');

      ok = false;

    } else if (!passwordsMatch(newPassword, confirmPassword)) {

      setConfirmError('Las contraseñas no coinciden.');

      ok = false;

    }



    return ok;

  }



  async function handleReset() {

    if (!validate()) return;



    setLoading(true);

    try {

      const result = verifiedViaLink

        ? await setPasswordFromActiveRecoverySession(newPassword)

        : await verifyRecoveryOtpAndSetPassword({

            email,

            token: otp.trim(),

            newPassword,

          });



      if (result.ok) {

        if (result.user) {

          await setSession(result.user, true);

        }

        toast.success(result.message, 'YaChanga');

        closeAuthModalAndGoToInicio();

        navigateToInicioTab();

      } else {

        setSubmitError(result.message);

        toast.error(result.message, 'Error', { durationMs: 4200 });

      }

    } finally {

      setLoading(false);

    }

  }



  async function handleResendCode() {

    if (resendCooldownSec > 0 || resendLoading) return;



    setResendLoading(true);

    try {

      const result = await resendPasswordRecoveryOtp(email);

      if (result.ok) {

        setOtp('');

        setSubmitError('');

        setOtpExpiresAt(Date.now() + RECOVERY_OTP_TTL_MS);

        setResendCooldownSec(Math.ceil(getRecoveryResendCooldownMs() / 1000));

        toast.success(result.message, 'YaChanga');

      } else {

        if (result.code === 'rate_limited') {

          setResendCooldownSec(Math.ceil(getRecoveryResendCooldownMs() / 1000));

        }

        setSubmitError(result.message);

        toast.error(result.message, 'Error', { durationMs: 4500 });

      }

    } catch (e) {

      const message =

        e instanceof Error ? e.message : 'No se pudo reenviar el código. Revisá tu conexión.';

      setSubmitError(message);

      toast.error(message, 'Error', { durationMs: 4500 });

    } finally {

      setResendLoading(false);

    }

  }



  return (

    <AuthPasswordFormShell onBack={() => navigation.navigate('ForgotPasswordRequest')}>

      <Text style={styles.title}>Nueva contraseña</Text>

      <Text style={styles.description}>

        {verifiedViaLink

          ? `Tu enlace fue verificado para ${email}. Elegí una nueva contraseña.`

          : `Ingresá el código que enviamos a ${email} y elegí tu nueva contraseña.`}

      </Text>



      {!verifiedViaLink ? (

        <>

          <Text style={styles.hint}>

            {otpExpired

              ? 'El código anterior venció. Pedí uno nuevo con «Reenviar código».'

              : `Código válido por ${formatCountdown(otpRemainingSec)} (usá el último email recibido).`}

          </Text>

          <AppTextInput

            label="Código de verificación"

            value={otp}

            onChangeText={(t) => {

              setOtp(t.replace(/\D/g, ''));

              setSubmitError('');

            }}

            keyboardType="number-pad"

            autoCapitalize="none"

            autoCorrect={false}

            placeholder="123456"

            error={otpError}

            maxLength={8}

          />

        </>

      ) : null}



      <AppTextInput

        label="Nueva contraseña"

        value={newPassword}

        onChangeText={(t) => {

          setNewPassword(t);

          setSubmitError('');

        }}

        passwordToggle

        placeholder="Mín. 8 caracteres, letra y número"

        error={newError}

        autoCapitalize="none"

        autoCorrect={false}

      />



      <AppTextInput

        label="Confirmar nueva contraseña"

        value={confirmPassword}

        onChangeText={(t) => {

          setConfirmPassword(t);

          setSubmitError('');

        }}

        passwordToggle

        placeholder="Repetí la nueva contraseña"

        error={confirmError}

        autoCapitalize="none"

        autoCorrect={false}

      />



      {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}



      <AppButton title="Restablecer contraseña" onPress={handleReset} loading={loading} />



      <View style={styles.linkWrap}>

        {!verifiedViaLink ? (

          <TextLink

            onPress={() => void handleResendCode()}

          >

            {resendLoading

              ? 'Reenviando…'

              : resendCooldownSec > 0

                ? `Reenviar código (${resendCooldownSec}s)`

                : 'Reenviar código'}

          </TextLink>

        ) : null}

        <TextLink onPress={() => navigation.navigate('Login')}>Volver al login</TextLink>

      </View>

    </AuthPasswordFormShell>

  );

}


