import { SectionTabsLayout } from '@/components/SectionTabsLayout';
import { SECTION_TABS } from '@/navigation/menu';

export default function StockLayout() {
  return <SectionTabsLayout tabs={SECTION_TABS.stock} />;
}
