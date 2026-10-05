import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router-dom';
import { resetPasswordBody, type ResetPasswordBody } from '@unita/contracts';
import { Alert, Button, Field, Input } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { authApi } from '@/services/api/endpoints';
import { AuthLayout } from './AuthLayout';
import { readRecoveryLink } from './recoveryToken';

export function ResetPasswordPage() {
  const location = useLocation();
  const [link] = useState(() => readRecoveryLink(location.search, location.hash));
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<ResetPasswordBody>({
    resolver: zodResolver(resetPasswordBody),
    defaultValues: { token: link.token },
  });

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    try {
      await authApi.resetPassword(data);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title={link.kind === 'invite' ? 'Defina sua senha' : 'Redefinir senha'}
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Ir para o login
        </Link>
      }
    >
      {done ? (
        <Alert tone="success" title="Senha alterada">
          Faça login com a nova senha. Sessões anteriores foram encerradas.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {(error || link.error || formState.errors.token) && (
            <Alert tone="error">{error ?? link.error ?? 'Link inválido ou incompleto.'}</Alert>
          )}
          <input type="hidden" {...register('token')} />
          <Field
            label="Nova senha"
            error={formState.errors.password?.message}
            hint="Mínimo de 10 caracteres, com letras e números."
          >
            <Input
              type="password"
              autoComplete="new-password"
              autoFocus
              {...register('password')}
            />
          </Field>
          <Field label="Confirmação" error={formState.errors.passwordConfirmation?.message}>
            <Input
              type="password"
              autoComplete="new-password"
              {...register('passwordConfirmation')}
            />
          </Field>
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Salvar nova senha
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
