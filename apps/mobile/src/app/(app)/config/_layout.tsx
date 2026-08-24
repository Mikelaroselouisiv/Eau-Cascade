import { SectionTabsLayout } from '@/components/SectionTabsLayout';
import { SECTION_TABS } from '@/navigation/menu';

export default function ConfigLayout() {
  return <SectionTabsLayout tabs={SECTION_TABS.config} />;
}
