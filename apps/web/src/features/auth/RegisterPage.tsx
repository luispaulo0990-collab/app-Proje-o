import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { registerBody, type RegisterBody } from '@unita/contracts';
import { Alert, Button, Field, Input } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './useAuth';

export function RegisterPage() {
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<RegisterBody>({
    resolver: zodResolver(registerBody),
  });
  const errors = formState.errors;

  const onSubmit = handleSubmit(async (data) => {
    setError(null);
    try {
      await signUp(data);
      navigate('/obras', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Novos usuários entram como visualizadores até um administrador liberar edição."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Nome" error={errors.name?.message}>
          <Input autoComplete="name" autoFocus {...register('name')} />
        </Field>
        <Field label="E-mail" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field
          label="Senha"
          error={errors.password?.message}
          hint="Mínimo de 10 caracteres, com letras e números."
        >
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Field label="Confirmação de senha" error={errors.passwordConfirmation?.message}>
          <Input
            type="password"
            autoComplete="new-password"
            {...register('passwordConfirmation')}
          />
        </Field>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
