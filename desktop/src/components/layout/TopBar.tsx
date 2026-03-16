import { useDesktopShellStore } from '../../store/useDesktopShellStore';

export function TopBar() {
  const viewMode = useDesktopShellStore((state) => state.viewMode);
  const platformBadge = useDesktopShellStore((state) => state.platformBadge);
  const kernelBadge = useDesktopShellStore((state) => state.kernelBadge);

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="eyebrow">Agent Host</span>
        <h1>OpenClaw Desktop</h1>
        <p className="topbar-subtitle">
          {viewMode === 'main' ? 'Agent 宿主机与通信工作台' : '首次启动配置向导'}
        </p>
      </div>
      <div className="topbar-right">
        <div className="badge badge-kernel" id="kernelVersionBadge">
          {kernelBadge}
        </div>
        <select id="langSelect" aria-label="Language">
          <option value="zh-CN">中文</option>
          <option value="en-US">English</option>
        </select>
        <div className="badge" id="platformBadge">
          {platformBadge}
        </div>
      </div>
    </header>
  );
}
