import { useCallback, useEffect, useState } from 'react';
import type { RemoteVpsWorkspaceConfigDto } from '../../../../../../shared/api/remote-vps';
import { Button, FieldRow, SegmentedControl, TextField } from '../../../../components/ui';
import './RemoteVpsCard.css';

interface Props {
  workspaceId: string;
  onConfigChange?: (config: RemoteVpsWorkspaceConfigDto | null) => void;
}

type ConnMode = 'ssh' | 'direct';
type ScopeMode = 'full' | 'runtime-only';

export const RemoteVpsCard = ({ workspaceId, onConfigChange }: Props) => {
  const [loaded, setLoaded] = useState(false);
  const [bound, setBound] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sshHosts, setSshHosts] = useState<string[]>([]);

  const [connMode, setConnMode] = useState<ConnMode>('ssh');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('full');
  const [sshHost, setSshHost] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [remotePort, setRemotePort] = useState('4770');
  const [token, setToken] = useState('');
  const [cwd, setCwd] = useState('');

  const [busy, setBusy] = useState<'test' | 'save' | 'migrate' | 'remove' | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) {
      setLoaded(true);
      onConfigChange?.(null);
      return;
    }
    setLoaded(false);
    setStatusMsg(null);
    void Promise.all([api.getConfig(workspaceId), api.listSshHosts()]).then(
      ([cfgRes, hostsRes]) => {
        setSshHosts(hostsRes.ok ? hostsRes.hosts : []);
        const cfg = cfgRes.ok ? cfgRes.config : null;
        onConfigChange?.(cfg);
        if (cfg) {
          setBound(true);
          setExpanded(false);
          setConnMode(cfg.endpoint ? 'direct' : 'ssh');
          setScopeMode(cfg.storage === 'local' ? 'runtime-only' : 'full');
          setSshHost(cfg.sshHost ?? '');
          setEndpoint(cfg.endpoint ?? '');
          setRemotePort(String(cfg.remotePort ?? 4770));
          setToken(cfg.token ?? '');
          setCwd(cfg.cwd ?? '');
        } else {
          setBound(false);
          setExpanded(false);
          setConnMode('ssh');
          setScopeMode('full');
          setSshHost('');
          setEndpoint('');
          setRemotePort('4770');
          setToken('');
          setCwd('');
        }
        setLoaded(true);
      },
    );
  }, [workspaceId, onConfigChange]);

  const buildDraftConfig = useCallback((): RemoteVpsWorkspaceConfigDto => {
    const parsedPort = Number.parseInt(remotePort, 10);
    return {
      kind: 'vps',
      ...(connMode === 'ssh'
        ? {
            sshHost: sshHost.trim(),
            remotePort: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 4770,
            autoBootstrap: true,
          }
        : { endpoint: endpoint.trim() }),
      ...(token.trim() ? { token: token.trim() } : {}),
      remoteWorkspaceId: workspaceId,
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      storage: scopeMode === 'full' ? 'vps' : 'local',
      runtime: 'vps',
    };
  }, [connMode, cwd, endpoint, remotePort, scopeMode, sshHost, token, workspaceId]);

  const canSubmit =
    connMode === 'ssh' ? Boolean(sshHost.trim()) : Boolean(endpoint.trim() && token.trim());

  const handleTest = useCallback(async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api || !canSubmit) return;
    setBusy('test');
    setStatusMsg(null);
    try {
      const res = await api.testAndBootstrap(workspaceId, buildDraftConfig());
      if (!res.ok) {
        setStatusMsg({ kind: 'err', text: res.error || '连接失败' });
        return;
      }
      if (res.token && !token.trim()) {
        setToken(res.token);
      }
      const notes = [
        res.uploaded ? '已推送 daemon' : null,
        res.installedDeps ? '已安装依赖' : null,
        res.restarted ? '已启动服务' : null,
      ].filter(Boolean);
      setStatusMsg({
        kind: 'ok',
        text: `已连接 VPS (v${res.version ?? '?'})${notes.length ? ` · ${notes.join(' / ')}` : ''}`,
      });
    } finally {
      setBusy(null);
    }
  }, [buildDraftConfig, canSubmit, token, workspaceId]);

  const handleSave = useCallback(async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api || !canSubmit) return;
    setBusy('save');
    setStatusMsg(null);
    try {
      const draft = buildDraftConfig();
      const res = await api.saveConfig(workspaceId, draft);
      if (!res.ok) {
        setStatusMsg({ kind: 'err', text: res.error || '保存失败' });
        return;
      }
      setBound(true);
      onConfigChange?.(draft);
      setStatusMsg({ kind: 'ok', text: 'VPS 配置已保存，重新打开工作区或新建终端即生效。' });
    } finally {
      setBusy(null);
    }
  }, [buildDraftConfig, canSubmit, onConfigChange, workspaceId]);

  const handleMigrate = useCallback(async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api || !canSubmit) return;
    setBusy('migrate');
    setStatusMsg(null);
    try {
      const draft = buildDraftConfig();
      const testRes = await api.testAndBootstrap(workspaceId, draft);
      if (!testRes.ok) {
        setStatusMsg({ kind: 'err', text: testRes.error || 'VPS 连接失败，已中止迁移' });
        return;
      }
      const resolvedDraft: RemoteVpsWorkspaceConfigDto = {
        ...draft,
        token: draft.token || testRes.token,
        storage: 'vps',
      };
      if (testRes.token && !token.trim()) setToken(testRes.token);
      const res = await api.migrateLocal(workspaceId, resolvedDraft);
      if (!res.ok) {
        setStatusMsg({ kind: 'err', text: res.error || '迁移失败' });
        return;
      }
      setBound(true);
      setScopeMode('full');
      onConfigChange?.(resolvedDraft);
      setStatusMsg({
        kind: 'ok',
        text: `迁移完成：已上传 ${res.uploadedFiles ?? 0} 个文件、${res.conversationCount ?? 0} 个会话（本机原数据已保留备份）。`,
      });
    } finally {
      setBusy(null);
    }
  }, [buildDraftConfig, canSubmit, onConfigChange, token, workspaceId]);

  const handleRemove = useCallback(async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setBusy('remove');
    setStatusMsg(null);
    try {
      const res = await api.removeConfig(workspaceId);
      if (!res.ok) {
        setStatusMsg({ kind: 'err', text: res.error || '解除绑定失败' });
        return;
      }
      setBound(false);
      onConfigChange?.(null);
      setStatusMsg({ kind: 'ok', text: '已解除 VPS 绑定，恢复为本机工作区。' });
    } finally {
      setBusy(null);
    }
  }, [onConfigChange, workspaceId]);

  if (!loaded || !window.canvasWorkspace?.remoteVps) return null;

  return (
    <section className="workspace-settings-section">
      <div className="remote-vps-header">
        <div className="workspace-settings-section-title">
          远端 VPS
          <span className={`remote-vps-badge ${bound ? 'is-bound' : ''}`}>
            {bound
              ? scopeMode === 'full'
                ? '已绑定 · 存算上云'
                : '已绑定 · 仅远端终端'
              : '本机运行'}
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : bound ? '管理配置' : '配置 VPS'}
        </Button>
      </div>

      {expanded && (
        <div className="remote-vps-body">
          <FieldRow
            label="连接方式"
            hint="SSH 模式会自动推送内置 daemon 并拉起加密隧道，无需发布公网 npm。"
          >
            <SegmentedControl
              options={[
                { id: 'ssh', label: 'SSH 自动推送' },
                { id: 'direct', label: '直连 (Tailscale / HTTP)' },
              ]}
              value={connMode}
              onChange={(id) => setConnMode(id as ConnMode)}
              ariaPattern="radio"
              ariaLabel="VPS 连接方式"
            />
          </FieldRow>

          <FieldRow
            label="托管范围"
            hint="旧工作区可先选「仅远端终端」保留本地画布，或一键迁移全部数据上云。"
          >
            <SegmentedControl
              options={[
                { id: 'full', label: '完整 VPS (画布 + 终端)' },
                { id: 'runtime-only', label: '仅远端终端 (画布留本机)' },
              ]}
              value={scopeMode}
              onChange={(id) => setScopeMode(id as ScopeMode)}
              ariaPattern="radio"
              ariaLabel="VPS 托管范围"
            />
          </FieldRow>

          {connMode === 'ssh' ? (
            <>
              <FieldRow label="SSH 主机" hint="填 user@ip 或点击下方本机 ~/.ssh/config 别名快速填入。">
                <div className="remote-vps-stack">
                  <TextField
                    value={sshHost}
                    onChange={(e) => setSshHost(e.target.value)}
                    placeholder="dev@your-vps 或 ~/.ssh/config 别名"
                  />
                  {sshHosts.length > 0 && (
                    <div className="remote-vps-host-chips">
                      {sshHosts.map((host) => (
                        <Button
                          key={host}
                          variant={sshHost === host ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => setSshHost(host)}
                        >
                          {host}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </FieldRow>
              <FieldRow label="远端端口" hint="VPS 仅监听 127.0.0.1，默认 4770。">
                <TextField
                  value={remotePort}
                  onChange={(e) => setRemotePort(e.target.value)}
                  placeholder="4770"
                />
              </FieldRow>
            </>
          ) : (
            <FieldRow
              label="服务端地址"
              hint="例如 Tailscale 私网 IP http://100.x.y.z:4770 或 HTTPS 域名。"
            >
              <TextField
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="http://100.x.y.z:4770"
              />
            </FieldRow>
          )}

          <FieldRow
            label="Bearer Token"
            hint={
              connMode === 'ssh'
                ? '可留空，点击「推送并测试连接」时自动在 VPS 生成并回填。'
                : '必填，需与 VPS 的 PULSE_VPS_TOKEN 一致。'
            }
          >
            <TextField
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={connMode === 'ssh' ? '留空则自动生成' : '输入 PULSE_VPS_TOKEN'}
            />
          </FieldRow>

          <FieldRow
            label="工作区根目录 (Root folder)"
            hint="VPS 上的项目根目录，用于终端、Coding Agent 以及 pulse-workspace.md。"
          >
            <TextField
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/home/dev/projects/my-app"
            />
          </FieldRow>

          {statusMsg && (
            <div className={`remote-vps-status ${statusMsg.kind === 'err' ? 'is-error' : 'is-ok'}`}>
              {statusMsg.text}
            </div>
          )}

          <div className="remote-vps-actions">
            <Button
              variant="secondary"
              disabled={!canSubmit || busy !== null}
              onClick={() => void handleTest()}
            >
              {busy === 'test' ? '推送连接中…' : connMode === 'ssh' ? '推送并测试连接' : '测试连接'}
            </Button>
            <Button
              variant="primary"
              disabled={!canSubmit || busy !== null}
              onClick={() => void handleSave()}
            >
              {busy === 'save' ? '保存中…' : '保存绑定'}
            </Button>
            {scopeMode === 'full' && (
              <Button
                variant="secondary"
                disabled={!canSubmit || busy !== null}
                onClick={() => void handleMigrate()}
              >
                {busy === 'migrate' ? '迁移中…' : '迁移本地数据到 VPS'}
              </Button>
            )}
            {bound && (
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void handleRemove()}
              >
                {busy === 'remove' ? '解除中…' : '解除绑定'}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
