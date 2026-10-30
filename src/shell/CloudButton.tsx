/**
 * Облако в шапке — перенос выпадающего списка лобби из `components/SearchBar.tsx`.
 * Значок с числом подключённых устройств; внутри — пинг до сервера, статус и список устройств.
 * Стрелок «отправитель / получатель» у своего устройства из старого здесь нет.
 */
import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useCloudState, type CloudState } from "../lib/cloudSync";
import { FilterDropdown, Icon, type SelectItem } from "../ui";

function PingNode({ cloud }: { cloud: CloudState }): ReactNode {
  const { t } = useI18n();
  const online = cloud.status === "online";
  const ms = online && cloud.pingMs != null ? Math.max(0, Math.round(cloud.pingMs)) : null;
  const dot =
    ms != null ? (ms < 120 ? "#22c55e" : ms < 350 ? "#eab308" : "#ef4444") : cloud.status === "connecting" || cloud.status === "retry" ? "#eab308" : "#fb923c";
  const hint =
    cloud.status === "connecting"
      ? t("lobby.cloudStatusConnecting")
      : cloud.status === "retry"
        ? t("lobby.cloudStatusReconnecting")
        : cloud.status === "off"
          ? t("lobby.cloudStatusLocalOnly")
          : null;
  return (
    <div className="cloud-ping">
      <div>
        <span className="cloud-dot" style={{ background: dot }} />
        <b>{ms != null ? `${ms} ms` : "—"}</b>
      </div>
      {hint && <p>{hint}</p>}
    </div>
  );
}

export function CloudButton() {
  const { t } = useI18n();
  const cloud = useCloudState();
  const count = cloud.peers.length;

  const items: SelectItem[] = [
    {
      type: "group",
      label: t("lobby.cloudTitle"),
      labelNode: (
        <span className="cloud-title">
          <Icon name="cloud" size={18} />
          {t("lobby.cloudTitle")}
        </span>
      ),
      subtitle: <PingNode cloud={cloud} />,
    },
    ...(count === 0
      ? [{ value: "_empty", label: t("lobby.noPeers") }]
      : cloud.peers.map((d) => ({
          value: d.device_id,
          label: d.device_name || d.device_id || "—",
          icon: <Icon name="smartphone" size={18} />,
        }))),
  ];

  return (
    <FilterDropdown
      options={items}
      keepOpen
      hideRadio
      trigger={({ onPress }) => (
        <button type="button" className="topbar-btn cloud-btn" aria-label={t("lobby.cloudTitle")} onClick={onPress}>
          <Icon name="cloud" size={18} />
          {count > 0 && <span className="cloud-badge">{count > 99 ? "99+" : count}</span>}
        </button>
      )}
    />
  );
}
