import { Input } from '@/components/ui';

/**
 * Competence month picker (`YYYY-MM`). Empty = current month on the server. Exposes the value
 * as `YYYY-MM-01` through `toReferenceDate` so every view queries the API the same way.
 */
export function ReferenceMonthInput({
  value,
  onChange,
  label = 'Referência',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-600">
      {label}
      <Input
        type="month"
        className="h-9 w-44"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export const toReferenceDate = (month: string) => (month ? `${month}-01` : undefined);
