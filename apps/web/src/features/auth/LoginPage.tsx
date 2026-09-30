import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { loginBody, type LoginBody } from '@unita/contracts';
import { Alert, Button, Field, Input } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './useAuth';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginBody>({
    resolver: zodResolver(loginBody),
  });

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    try {
      await login(data);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/obras', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Painel de projeção físico-financeira de obras"
      footer={
        <>
          Ainda não tem acesso?{' '}
          <Link to="/cadastro" className="font-medium text-primary hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="E-mail" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...register('email')} />
        </Field>
        <Field label="Senha" error={formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        <div className="flex justify-end">
          <Link to="/esqueci-senha" className="text-sm text-primary hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
