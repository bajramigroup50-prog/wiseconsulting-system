import { EF_STATUS } from '@wise/core/finance';

export { can } from '@wise/core';
export const EF_STATUS_KEYS = Object.keys(EF_STATUS);
export interface FirmEf { id?: string; cert?: string; certTo?: string; st?: string }
export const efOf = (settings: unknown): FirmEf => (((settings ?? {}) as { ef?: FirmEf }).ef ?? {});
