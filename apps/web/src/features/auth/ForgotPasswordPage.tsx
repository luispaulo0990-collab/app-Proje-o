import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { forgotPasswordBody, type ForgotPasswordBody } from '@unita/contracts';
import { Alert, Button, Field, Input } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { authApi } from '@/services/api/endpoints';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<ForgotPasswordBody>({
    resolver: zodResolver(forgotPasswordBody),
  });

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    try {
      await authApi.forgotPassword(data);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Enviaremos um link de redefinição para o seu e-mail."
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Voltar ao login
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success" title="Verifique seu e-mail">
          Se o endereço estiver cadastrado, você receberá o link em instantes.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="E-mail" error={formState.errors.email?.message}>
            <Input type="email" autoComplete="email" autoFocus {...register('email')} />
          </Field>
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
