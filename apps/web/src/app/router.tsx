import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { GuestRoute, ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { WorkLayout } from '@/features/projections/WorkLayout';
import { WorksPage } from '@/features/works/WorksPage';

/** Route-level code splitting: heavy pages (charts, editors) load on demand. */
function page<M extends Record<string, unknown>>(loader: () => Promise<M>, name: keyof M & string) {
  return async () => ({ Component: (await loader())[name] as ComponentType });
}

export const router = createBrowserRouter([
  {
    element: <GuestRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/cadastro', element: <RegisterPage /> },
      { path: '/esqueci-senha', element: <ForgotPasswordPage /> },
    ],
  },
  { path: '/redefinir-senha', element: <ResetPasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/obras" replace /> },
          { path: '/obras', element: <WorksPage /> },
          {
            path: '/obras/:id',
            element: <WorkLayout />,
            children: [
              {
                index: true,
                lazy: page(() => import('@/features/projections/ProjectionPage'), 'ProjectionPage'),
              },
              {
                path: 'informacoes',
                lazy: page(() => import('@/features/projections/WorkInfoPage'), 'WorkInfoPage'),
              },
              {
                path: 'curva',
                lazy: page(() => import('@/features/projections/WorkCurvePage'), 'WorkCurvePage'),
              },
              {
                path: 'taxa',
                lazy: page(
                  () => import('@/features/fee-terms/WorkFeeTermsPage'),
                  'WorkFeeTermsPage',
                ),
              },
              {
                path: 'historico',
                lazy: page(
                  () => import('@/features/projections/WorkHistoryPage'),
                  'WorkHistoryPage',
                ),
              },
              {
                path: 'configuracoes',
                lazy: page(
                  () => import('@/features/projections/WorkSettingsPage'),
                  'WorkSettingsPage',
                ),
              },
            ],
          },
          {
            path: '/curvas',
            lazy: page(() => import('@/features/curves/CurvesPage'), 'CurvesPage'),
          },
          {
            path: '/consolidado',
            lazy: page(() => import('@/features/portfolio/ConsolidatedPage'), 'ConsolidatedPage'),
          },
          {
            path: '/curvas-obras',
            lazy: page(() => import('@/features/work-curves/WorkCurvesPage'), 'WorkCurvesPage'),
          },
          {
            path: '/curvas/:id',
            lazy: page(() => import('@/features/curves/CurveDetailPage'), 'CurveDetailPage'),
          },
          {
            element: <ProtectedRoute minimum="EDITOR" />,
            children: [
              {
                path: '/obras/nova',
                lazy: page(() => import('@/features/works/WorkFormPage'), 'WorkFormPage'),
              },
              {
                path: '/obras/:id/editar',
                lazy: page(() => import('@/features/works/WorkFormPage'), 'WorkFormPage'),
              },
            ],
          },
          {
            element: <ProtectedRoute minimum="ADMIN" />,
            children: [
              {
                path: '/curvas/nova',
                lazy: page(() => import('@/features/curves/CurveEditorPage'), 'CurveEditorPage'),
              },
              {
                path: '/curvas/:id/nova-versao',
                lazy: page(() => import('@/features/curves/CurveEditorPage'), 'CurveEditorPage'),
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/obras" replace /> },
]);
