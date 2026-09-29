import { EmptyState, PrithviPage } from '@/components/ui/prithvi-page';

export function CapabilityScreen({ title, eyebrow, subtitle, emptyTitle, description, label }: { title: string; eyebrow: string; subtitle: string; emptyTitle: string; description: string; label?: string }) {
  return <PrithviPage title={title} eyebrow={eyebrow} subtitle={subtitle}><EmptyState title={emptyTitle} description={description} label={label} /></PrithviPage>;
}
