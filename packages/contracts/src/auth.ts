import { z } from 'zod';
import { roleSchema, uuid } from './common.js';

const email = z.email('E-mail inválido.').trim().toLowerCase().max(254);

/** OWASP-aligned: length over composition rules. */
export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter pelo menos 10 caracteres.')
  .max(128, 'A senha deve ter no máximo 128 caracteres.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'A senha deve conter letras e números.');

export const registerBody = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome.').max(120),
    email,
    password: passwordSchema,
    passwordConfirmation: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirmation, {
    message: 'As senhas não conferem.',
    path: ['passwordConfirmation'],
  });
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({
  email,
  password: z.string().min(1, 'Informe a senha.').max(128),
});
export type LoginBody = z.infer<typeof loginBody>;

export const forgotPasswordBody = z.object({ email });
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBody>;

export const resetPasswordBody = z
  .object({
    // Our opaque reset token, or the Supabase access token from the recovery/invite link.
    token: z.string().min(20).max(4096),
    password: passwordSchema,
    passwordConfirmation: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirmation, {
    message: 'As senhas não conferem.',
    path: ['passwordConfirmation'],
  });
export type ResetPasswordBody = z.infer<typeof resetPasswordBody>;

export const userDto = z.object({
  id: uuid,
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof userDto>;

export const authResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: userDto,
});
export type AuthResponse = z.infer<typeof authResponse>;

export const authConfigDto = z.object({
  /** `supabase`: users are created in Supabase → Authentication (no sign-up screen). */
  provider: z.enum(['local', 'supabase']),
  registrationEnabled: z.boolean(),
});
export type AuthConfigDto = z.infer<typeof authConfigDto>;

export const updateUserRoleBody = z.object({ role: roleSchema, isActive: z.boolean().optional() });
export type UpdateUserRoleBody = z.infer<typeof updateUserRoleBody>;
