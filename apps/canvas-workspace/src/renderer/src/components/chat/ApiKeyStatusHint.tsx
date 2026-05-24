import type { CanvasModelProviderStatus } from '../../types';

interface ApiKeyStatusHintProps {
  status?: CanvasModelProviderStatus;
  drafting: boolean;
}

export const ApiKeyStatusHint = ({ status, drafting }: ApiKeyStatusHintProps) => {
  if (drafting) {
    return <span className="chat-model-field-hint chat-model-field-hint--info">将用输入的新 Key 覆盖已保存的值</span>;
  }
  if (!status) return null;
  if (status.apiKeyPresent) {
    const length = status.apiKeyLength;
    const lengthSuffix = typeof length === 'number' && length > 0 ? `（共 ${length} 字符）` : '';
    const source = status.api_key_env && !length ? `（来自环境变量 ${status.api_key_env}）` : '';
    return (
      <span className="chat-model-field-hint chat-model-field-hint--ok">
        ✓ 已保存{lengthSuffix}{source}
      </span>
    );
  }
  return <span className="chat-model-field-hint chat-model-field-hint--warn">未设置 API Key — 调用模型时会失败</span>;
};
