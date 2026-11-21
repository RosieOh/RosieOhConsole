import { Settings as SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { AccessAdmin } from './AccessAdmin';
import { BuildNotifyAdmin } from './BuildNotifyAdmin';
import { CatalogEditor } from './CatalogEditor';
import { TabPanel, Tabs, useHashTab } from './Tabs';

export function Settings({ me }: { me: string }) {
  const [tab, setTab] = useHashTab(['catalog', 'access', 'notify'], 'catalog');
  return (
    <div>
      <div className="topbar">
        <div>
          <h1><SettingsIcon size={22} />설정</h1>
          <div className="sub">서비스 이름, 로고, 묶음과 사람별 권한, 빌드 알림 받는 사람</div>
        </div>
      </div>
      <Tabs tabs={[['catalog', '서비스 카탈로그'], ['access', '권한'], ['notify', '빌드 알림']]} value={tab} onChange={setTab} />
      <TabPanel k={tab}>{tab === 'catalog' ? <CatalogEditor /> : tab === 'access' ? <AccessAdmin me={me} /> : <BuildNotifyAdmin />}</TabPanel>
    </div>
  );
}
