import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponse, idParams, updateUserRoleBody, userDto } from '@unita/contracts';
import { auditRepository } from '../../database/repositories/audit.repository.js';
import { tokensRepository } from '../../database/repositories/tokens.repository.js';
import { usersRepository } from '../../database/repositories/users.repository.js';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { toUserDto } from '../auth/auth.service.js';

/** User administration (ADMIN only): list users, change role, activate/deactivate. */
export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.deps;
  const tags = ['users'];
  const security = [{ bearerAuth: [] }];

  app.get(
    '/',
    {
      preHandler: requireRole('ADMIN'),
      schema: {
        tags,
        security,
        summary: 'Lista usuários',
        response: { 200: z.object({ items: z.array(userDto) }) },
      },
    },
    async () => ({ items: (await usersRepository.list(db)).map(toUserDto) }),
  );

  app.patch(
    '/:id',
    {
      preHandler: requireRole('ADMIN'),
      schema: {
        tags,
        security,
        summary: 'Altera papel/ativação',
        params: idParams,
        body: updateUserRoleBody,
        response: { 200: userDto, 400: errorResponse, 404: errorResponse },
      },
    },
    async (req) => {
      const admin = currentUser(req);
      if (req.params.id === admin.id) throw badRequest('Você não pode alterar o próprio papel.');
      const before = await usersRepository.findById(db, req.params.id);
      if (!before) throw notFound('Usuário');
      const updated = await db.transaction(async (tx) => {
        const row = await usersRepository.update(tx, before.id, {
          role: req.body.role,
          isActive: req.body.isActive ?? before.isActive,
        });
        if (!row) throw notFound('Usuário');
        if (!row.isActive) await tokensRepository.revokeAllForUser(tx, row.id);
        await auditRepository.insert(tx, {
          userId: admin.id,
          action: 'UPDATE',
          entity: 'user',
          entityId: row.id,
          field: 'role',
          oldValue: `${before.role}${before.isActive ? '' : ' (inativo)'}`,
          newValue: `${row.role}${row.isActive ? '' : ' (inativo)'}`,
        });
        return row;
      });
      return toUserDto(updated);
    },
  );
};
