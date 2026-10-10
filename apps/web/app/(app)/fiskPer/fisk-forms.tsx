'use client';
/** DFI control settings (legacy `dfiHTML` 11501) and the device register form (legacy `devHTML` 11511). */
import { ActionForm } from '@/components/action-form';
import { saveDeviceAction, saveDfiSettingsAction } from './actions';

export function DfiSettings({ offDays, cashMax, depDays }: { offDays: string; cashMax: number; depDays: number }) {
  return (
    <ActionForm action={saveDfiSettingsAction} reset={false}>
      <div className="row" style={{ gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f">Неработни денови<select name="offDays" defaultValue={offDays}>
          <option value="">ниеден</option><option value="0">недела</option><option value="0,6">сабота и недела</option><option value="6">сабота</option></select></label>
        <label className="f">Благајнички максимум (ден.)<input name="cashMax" inputMode="decimal" defaultValue={cashMax || ''} style={{ width: 130 }} /></label>
        <label className="f">Полог до (дена)<input name="depDays" type="number" min={0} max={60} defaultValue={depDays || ''} style={{ width: 90 }} /></label>
        <button className="btn sm pri">Зачувај</button>
      </div>
    </ActionForm>
  );
}

export function DeviceForm({ locs, suggest }: { locs: { id: string; name: string }[]; suggest: string }) {
  return (
    <ActionForm action={saveDeviceAction}>
      <h3 style={{ margin: '0 0 6px' }}>+ Апарат</h3>
      <div className="form">
        <label className="f">Сериски број (ФМ)<input name="serial" defaultValue={suggest} required /></label>
        <label className="f">Објект<select name="wh">{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="f">Марка<input name="brand" placeholder="на пр. David, Expert SX" /></label>
        <label className="f">Модел<input name="model" /></label>
        <label className="f">Поврзување<select name="conn"><option value="">—</option><option>USB</option><option>COM</option><option>LAN</option><option>WiFi</option><option>самостоен</option></select></label>
        <label className="f">Порт / брзина / IP<input name="port" placeholder="COM3 / 115200 или 192.168.1.50" /></label>
        <label className="f">Оператор<input name="operator" /></label>
        <label className="f">Режим<input name="mode" placeholder="продажба / угостителство" /></label>
        <label className="f">Фискализиран<select name="fiscal"><option value="да">да</option><option value="не">не</option></select></label>
        <label className="f">Сервисер<input name="servicer" /></label>
        <label className="f">Последен сервис<input type="date" name="lastSvc" /></label>
        <label className="f">Следен сервис<input type="date" name="nextSvc" /></label>
      </div>
      <button className="btn pri">Зачувај апарат</button>
    </ActionForm>
  );
}
