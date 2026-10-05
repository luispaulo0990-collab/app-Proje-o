import type {
  ActualCurveBody,
  ActualCurveStateDto,
  AuditLogDto,
  ConsolidatedDto,
  FeeIssuanceBody,
  FeeIssuanceResponse,
  InccIndexBody,
  InccIndexListResponse,
  InccIndexResponse,
  ProgressIndicatorsDto,
  CurveSyncReportDto,
  IntegrationStatusDto,
  AuthConfigDto,
  AuthResponse,
  CreateCurveBody,
  CurveDetailDto,
  CurvePointDto,
  CurvePointInputDto,
  CurveSummaryDto,
  CurveVersionDto,
  ForgotPasswordBody,
  ImportActualCurveResponse,
  LoginBody,
  ProjectionDto,
  RegisterBody,
  ResetPasswordBody,
  UpdateCurveBody,
  UpdateProjectionBody,
  SyncWorkCurvesResponse,
  UserDto,
  WorkBodyInput,
  WorkCurvesResponse,
  WorkDto,
} from '@unita/contracts';
import { api } from './client';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ValidationIssueDto {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export const authApi = {
  config: () => api.get<AuthConfigDto>('/auth/config'),
  login: (body: LoginBody) => api.post<AuthResponse>('/auth/login', body, false),
  register: (body: RegisterBody) => api.post<AuthResponse>('/auth/register', body, false),
  logout: () => api.post<undefined>('/auth/logout', undefined, false),
  forgotPassword: (body: ForgotPasswordBody) =>
    api.post<undefined>('/auth/forgot-password', body, false),
  resetPassword: (body: ResetPasswordBody) =>
    api.post<undefined>('/auth/reset-password', body, false),
  me: () => api.get<UserDto>('/auth/me'),
};

export interface WorkFilters {
  q?: string;
  status?: string;
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
}

export const worksApi = {
  list: (filters: WorkFilters) => api.get<Page<WorkDto>>('/works', { ...filters }),
  get: (id: string) => api.get<WorkDto>(`/works/${id}`),
  create: (body: WorkBodyInput) => api.post<WorkDto>('/works', body),
  update: (id: string, body: WorkBodyInput) => api.put<WorkDto>(`/works/${id}`, body),
  duplicate: (id: string) => api.post<WorkDto>(`/works/${id}/duplicate`),
  archive: (id: string) => api.post<WorkDto>(`/works/${id}/archive`),
  remove: (id: string) => api.delete<undefined>(`/works/${id}`),
  audit: (id: string, page = 1) => api.get<Page<AuditLogDto>>(`/works/${id}/audit`, { page }),
  clients: () => api.get<{ items: { id: string; name: string }[] }>('/clients'),
};

export const curvesApi = {
  list: (q?: string) => api.get<Page<CurveSummaryDto>>('/curves', { q }),
  get: (id: string) => api.get<CurveDetailDto>(`/curves/${id}`),
  version: (id: string, version: number) =>
    api.get<CurveVersionDto>(`/curves/${id}/versions/${version}`),
  create: (body: CreateCurveBody) => api.post<CurveDetailDto>('/curves', body),
  update: (id: string, body: UpdateCurveBody) => api.put<CurveDetailDto>(`/curves/${id}`, body),
  validate: (points: CurvePointInputDto[]) =>
    api.post<{ valid: boolean; issues: ValidationIssueDto[]; canonical: CurvePointDto[] | null }>(
      '/curves/validate',
      { points },
    ),
};

export const projectionsApi = {
  get: (workId: string, referenceDate?: string) =>
    api.get<ProjectionDto>(`/projections/${workId}`, { referenceDate }),
  calculate: (
    workId: string,
    body: { mode: 'PRESERVE_MANUAL' | 'REPLACE_MANUAL'; dryRun?: boolean },
  ) =>
    api.post<ProjectionDto | { dryRun: true; manualCount: number }>(
      `/projections/${workId}/calculate`,
      body,
    ),
  update: (workId: string, body: UpdateProjectionBody) =>
    api.put<ProjectionDto>(`/projections/${workId}`, body),
};

export interface PortfolioFilters {
  referenceDate?: string;
  q?: string;
  includeArchived?: boolean;
}

export const portfolioApi = {
  consolidated: (filters: PortfolioFilters) =>
    api.get<ConsolidatedDto>('/portfolio/consolidated', { ...filters }),
  progress: (workId: string) =>
    api.get<ProgressIndicatorsDto>(`/works/${workId}/progress-indicators`),
};

/** Fee inputs of the Consolidado. Months travel as `AAAA-MM-01`. */
export const feesApi = {
  setIssuance: (workId: string, month: string, body: FeeIssuanceBody) =>
    api.put<FeeIssuanceResponse>(`/works/${workId}/fee-issuances/${month}`, body),
  deleteIssuance: (workId: string, month: string) =>
    api.delete<FeeIssuanceResponse>(`/works/${workId}/fee-issuances/${month}`),
  listIncc: () => api.get<InccIndexListResponse>('/incc-indices'),
  setIncc: (month: string, body: InccIndexBody) =>
    api.put<InccIndexResponse>(`/incc-indices/${month}`, body),
  deleteIncc: (month: string) => api.delete<InccIndexResponse>(`/incc-indices/${month}`),
};

export const workCurvesApi = {
  list: (filters: PortfolioFilters) => api.get<WorkCurvesResponse>('/work-curves', { ...filters }),
  sync: () => api.post<SyncWorkCurvesResponse>('/work-curves/sync'),
  actual: (workId: string) => api.get<ActualCurveStateDto>(`/works/${workId}/actual-curve`),
  importActual: (workId: string, body: ActualCurveBody) =>
    api.put<ImportActualCurveResponse>(`/works/${workId}/actual-curve`, body),
};

export const integrationsApi = {
  status: () => api.get<IntegrationStatusDto>('/integrations/status'),
  syncWorkCurves: (dryRun: boolean) =>
    api.post<CurveSyncReportDto>('/integrations/work-curves/sync', { dryRun }),
};
